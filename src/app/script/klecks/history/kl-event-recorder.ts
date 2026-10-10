import { KlChainRecorder } from './kl-chain-recorder';
import { KlEventReplayer } from './kl-event-replayer';
import {
  DEBUG_RECORDER,
  LOG_STYLE_RECORDER,
  TIMESPAN_ACCUMULATION_MS,
  TEventRecordedCallback,
  TEventType,
  TGetEventsOptions,
  TRecordedEvent,
  TRecorderConfig,
  TReplayConfig,
  TReplayStats,
} from './kl-event-types';
import { IEventStorageProvider } from './kl-event-storage-provider';

/**
 * Records user events for later replay functionality.
 * Recording is paused by default, please call "start()" to begin.
 */
export class KlEventRecorder {
  private projectId: string = '';
  private sequenceNumber: number = 0;
  private lastTimestamp: number = 0; // ms since epoch
  private totalTimeTaken: number = 0; // ms taken drawing in this project
  private listeners: Array<TEventRecordedCallback> = [];
  private isPaused: boolean = true;
  private replayer: KlEventReplayer;
  private storageProvider: IEventStorageProvider | undefined;
  private isStoringInProgress: boolean = false;
  // What is still to be done to the storage, in order: see enqueueStorageOperation.
  private pendingStorageOperations: Array<() => Promise<void> | undefined> = [];
  private previousEvent: TRecordedEvent | null = null;
  // The event recorded before previousEvent: what is "previous" again once that one is taken back.
  private eventBeforePrevious: TRecordedEvent | null = null;
  // True once the selection that a layer move brings with it was left out (see sanitizeDuplicateEvents).
  private hasSkippedSelectionOfMove: boolean = false;

  constructor(projectId: string, config?: TRecorderConfig, storageProvider?: IEventStorageProvider) {
    this.projectId = projectId;
    if (config?.onEvent) {
      this.listeners.push(config.onEvent);
    }

    this.replayer = new KlEventReplayer();
    this.storageProvider = storageProvider;

    if (storageProvider) {
      // Register a listener to synchronously call the store function
      this.listeners.push(this.saveToStorage.bind(this));
    }
  }

  private saveToStorage(event: TRecordedEvent) {
    this.enqueueStorageOperation(() => this.storageProvider?.storeEvent(event), 'Failed to store event. Error:');
  }

  private removePreviousFromStorage() {
    this.enqueueStorageOperation(
      () => this.storageProvider?.removePreviousEvent(),
      'Failed to remove the previous event. Error:'
    );
  }

  /**
   * Everything that changes the storage goes through this queue, one operation at a time and in
   * the order it was asked for. The storage is asynchronous and "remove the previous event" means
   * whatever it holds last: when a store was still under way (or, as it used to be, waiting for
   * a retry timer), a removal overtook it and took away the event before — a stroke, a layer.
   *
   * An idle queue runs the operation at once, within the call.
   */
  private enqueueStorageOperation(operation: () => Promise<void> | undefined, errorMessage: string) {
    this.pendingStorageOperations.push(() => {
      try {
        return Promise.resolve(operation()).catch(error => {
          console.error('%c[REC]', LOG_STYLE_RECORDER, errorMessage, error);
        });
      } catch (error) {
        console.error('%c[REC]', LOG_STYLE_RECORDER, errorMessage, error);
        return undefined;
      }
    });
    this.runStorageQueue();
  }

  private runStorageQueue() {
    if (this.isStoringInProgress) return;
    const operation = this.pendingStorageOperations.shift();
    if (!operation) return;

    this.isStoringInProgress = true;
    Promise.resolve(operation()).finally(() => {
      this.isStoringInProgress = false;
      this.runStorageQueue();
    });
  }

  /**
   * Create an instance of a chain-recorder to record brush events
   */
  createChainRecorder(getBrushData: () => any) {
    return new KlChainRecorder(drawEvents => {
      // Line ended:
      this.record('draw', {
        events: drawEvents,
        brush: getBrushData(),
      });
    });
  }

  /**
   * Record an event.
   *
   * `duplicates` says what becomes of the previous event:
   * - 'auto' (default): the recorder decides by its own rules (sanitizeDuplicateEvents).
   * - 'keep': it stays; the new event is recorded after it.
   * - 'replace': it is taken back and the new event recorded in its place.
   * - 'discard-both': it is taken back and the new event is not recorded — the two cancel out.
   * The application passes the last three for layer selections, where it knows what the undo
   * history made of the selection: recording and history have to count the same steps.
   */
  record(type: TEventType, data: any, duplicates: 'auto' | 'keep' | 'replace' | 'discard-both' = 'auto'): void {
    const event: TRecordedEvent = {
      projectId: this.projectId,
      timestamp: Date.now(),
      type: type,
      data: data,
      sequenceNumber: this.sequenceNumber + 1,
    };

    // Some user action is taking place, record the time!
    this.calculateTimeTaken();

    // Don't record if paused — and decide that first: what follows may take an event out of the
    // storage, and an event that is not recorded must not cost a stored one. (A replay plays
    // layer selections through the same code that records them; with the checks the other way
    // round, every replayed selection deleted the last event of the paper.)
    if (this.isPaused || this.replayer?.isCurrentlyReplaying()) {
      return;
    }

    // Check for duplicate events before recording
    const sanitizeDuplicateEventsStrategy =
      duplicates === 'auto' ? this.sanitizeDuplicateEvents(event) : duplicates === 'keep' ? false : duplicates;
    if (sanitizeDuplicateEventsStrategy == 'discard') {
      if (DEBUG_RECORDER) {
        console.log('%c[REC]', LOG_STYLE_RECORDER, `Ignoring event (${type})`);
      }

      return;
    } else if (sanitizeDuplicateEventsStrategy == 'discard-both') {
      if (DEBUG_RECORDER) {
        console.log('%c[REC]', LOG_STYLE_RECORDER, `Ignoring both events (${type})`);
      }

      this.removePreviousFromStorage();
      this.previousEvent = this.eventBeforePrevious;
      this.eventBeforePrevious = null;
      return;
    } else if (sanitizeDuplicateEventsStrategy == 'replace') {
      if (DEBUG_RECORDER) {
        console.log('%c[REC]', LOG_STYLE_RECORDER, `Replacing event (${type})`);
      }

      this.removePreviousFromStorage();
      this.previousEvent = this.eventBeforePrevious;
      // continue.
    }

    // Increase counter
    this.sequenceNumber++;

    // Update previous event reference
    this.eventBeforePrevious = this.previousEvent;
    this.previousEvent = event;
    this.hasSkippedSelectionOfMove = false;

    if (DEBUG_RECORDER) {
      console.log('%c[REC]', LOG_STYLE_RECORDER, 'Recording event', event);
    }

    // Notify listeners
    for (const cb of this.listeners) {
      try {
        cb(event, this.totalTimeTaken);
      } catch (error) {
        console.error('%c[REC]', LOG_STYLE_RECORDER, 'Failed to notify listeners. Error:', error);
      }
    }
  }

  /**
   * The type of the event recorded last (after loading: of the paper's last event), if any.
   */
  getPreviousEventType(): TEventType | null {
    return this.previousEvent?.type ?? null;
  }

  /**
   * Gets the total time taken for all recorded events, aka the "total drawing time"
   * in ms
   */
  getTimeTaken(): number {
    return this.totalTimeTaken;
  }

  private calculateTimeTaken() {
    const now = Date.now();
    if (this.lastTimestamp && now - this.lastTimestamp <= TIMESPAN_ACCUMULATION_MS) {
      // Add the time since last event
      this.totalTimeTaken += now - this.lastTimestamp;
    } else {
      // Just add 100ms
      this.totalTimeTaken += 100;
    }
    this.lastTimestamp = now;
  }

  /**
   * Cleanup
   */
  destroy() {
    this.sequenceNumber = 0;
    this.lastTimestamp = 0;
    this.totalTimeTaken = 0;
    this.previousEvent = null;
    this.eventBeforePrevious = null;
  }

  /**
   * Pause event recording - events will be ignored until resumed
   */
  pause() {
    this.isPaused = true;
    console.log('%c[REC]', LOG_STYLE_RECORDER, 'Recording paused');
  }

  /**
   * Start or resume event recording
   */
  start() {
    this.isPaused = false;
    this.lastTimestamp = 0; // Reset timestamp to avoid time accumulation during pause
    console.log('%c[REC]', LOG_STYLE_RECORDER, 'Recording started/resumed');
  }

  /**
   * Check if recording is currently paused
   */
  isRecordingPaused(): boolean {
    return this.isPaused;
  }

  /**
   * Register an event listener to be notified on new recorded events
   */
  subscribe(callback: TEventRecordedCallback) {
    if (this.listeners.includes(callback)) {
      return;
    }
    this.listeners.push(callback);
  }

  /**
   * Unregister an event listener
   */
  unsubscribe(callback: TEventRecordedCallback) {
    this.listeners = this.listeners.filter(cb => cb !== callback);
  }

  /**
   * Set an event replayer to avoid recording events while replaying
   */
  getReplayer(): KlEventReplayer {
    return this.replayer;
  }

  /**
   * Loads events from the defined storageProvider.
   * Invokes an "instant replay" if no config-parameter is defined.
   */
  async loadFromStorage(config?: TReplayConfig): Promise<TReplayStats | 'empty-storage' | null> {
    const events = await this.storageProvider?.getEvents();
    if (!events) {
      console.warn(
        '%c[REC]',
        LOG_STYLE_RECORDER,
        'No storage provider defined. If you would like to replay events, use the eventReplayer.startReplay() method and provide your own data, or define your own IEventStorageProvider and pass it into the constructor of the KlEventRecorder.'
      );
      return null;
    }

    // Ensure correct order
    events.sort((a, b) => a.sequenceNumber - b.sequenceNumber);

    this.lastTimestamp = 0;
    // The highest number in use; record() counts on from it.
    this.sequenceNumber = events.reduce((max, evnt) => Math.max(max, evnt.sequenceNumber), 0);

    if (events.length <= 1) {
      // Nothing, or only the initial 'reset' (the page was closed before the paper was set up):
      // the caller sets the paper up anew. The numbering goes on behind what is stored — a second
      // event with the number 1 would sort to an arbitrary place in every later replay.
      return 'empty-storage';
    }
    this.totalTimeTaken =
      events.length > 0
        ? events.reduce((acc, evnt, index) => {
            // Recalculate the time drawn. The following code is semantically equivalent to calculateTimeTaken()
            if (index === 0) return acc;
            const prevEvent = events[index - 1];
            const timeDiff = evnt.timestamp - prevEvent.timestamp;
            if (timeDiff <= TIMESPAN_ACCUMULATION_MS) {
              return acc + timeDiff;
            }
            return acc + 100;
          }, 0)
        : 0;

    // Start the replaying
    const returnResult = await this.replayer.startReplay(events, config ?? {});

    this.previousEvent = events[events.length - 1];

    // Done
    console.log(
      '%c[REC]',
      LOG_STYLE_RECORDER,
      `Loaded ${events.length} events from storage for project ${this.projectId}. Final SequenceNumber is ${this.sequenceNumber}`
    );
    return returnResult;
  }

  /**
   * Get events from storage provider with optional filtering
   */
  async getEvents(options?: TGetEventsOptions): Promise<TRecordedEvent[]> {
    const events = (await this.storageProvider?.getEvents(options)) ?? [];
    // Ensure correct order
    events.sort((a, b) => a.sequenceNumber - b.sequenceNumber);
    return events;
  }

  /**
   * Clear all events from storage
   */
  async clearEvents(): Promise<void> {
    await this.storageProvider?.clearEvents();
  }

  /**
   * Get the count of stored events
   */
  async getEventCount(): Promise<number> {
    return (await this.getEvents()).length;
  }

  /**
   * Check if any events exist in the storageProvider
   */
  async hasEvents(): Promise<boolean> {
    return (await this.getEventCount()) > 0;
  }

  private sanitizeDuplicateEvents(newEvent: TRecordedEvent): false | 'replace' | 'discard' | 'discard-both' {
    if (!this.previousEvent) {
      return false; // No previous event to compare with
    }

    // Custom criteria for when not to save the event
    if (newEvent.type == 'l-select') {
      if (this.previousEvent.type == 'l-move') {
        // A move brings one selection with it (the layer controller re-selects the active
        // layer): that one is left out. Any further selection is the user's and is recorded —
        // the move stays the previous event while selections are left out, so without this
        // flag every selection after a move was dropped until something else was recorded.
        if (this.hasSkippedSelectionOfMove) return false;
        this.hasSkippedSelectionOfMove = true;
        return 'discard';
      } else if (this.previousEvent.type == 'l-select') return 'replace';
    }
    // This is an idea of merging "l-move" events, to reduce epileptic flickering, but this is bad because it breaks the undo history.
    /*else if (newEvent.type == 'l-move' && this.previousEvent.type == 'l-move') {
      // data = [startIndex, relativePosition]
      const newLayers: number[] = newEvent.data ?? [];
      const prevLayers: number[] = this.previousEvent.data ?? [];
      if (newLayers.length === prevLayers.length && newLayers.every((value, index) => value === prevLayers[index])) {
        return 'discard-both'; // Moving a layer to the same position TWICE cancels out.
      }
    }*/

    return false;
  }
}
