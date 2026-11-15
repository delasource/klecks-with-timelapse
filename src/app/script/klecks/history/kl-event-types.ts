/**
 * Configuration options for the event recorder
 */
export type TRecorderConfig = {
  /**
   * Callback when a new event is recorded.
   */
  onEvent?: TEventRecordedCallback;
};

/**
 * Configuration options for replay behavior
 */
export type TReplayConfig = {
  /** Target frames per second for the replay animation */
  targetFps?: number;
  /** Total time in milliseconds for the complete replay */
  replayTimeInMs?: number;
  /** Whether to skip sleeping, outputing frames as fast as possible */
  noSleep?: boolean;
  /** Callback called on each frame during replay */
  onFrame?: (currentIndex: number, totalEvents: number) => Promise<void>;
};

/**
 * All Event Types / Actions
 * Note: frequent words in high frequent actions like "canvas" or "layer"
 * are omitted to save in memory and bandwidth.
 */
export type TEventType =
  | 'undo'
  | 'redo'
  | 'draw'
  | 'reset'
  | 'setup-done'
  | 'resize'
  | 'resize-c'
  | 'l-flip'
  | 'l-select'
  | 'l-fill'
  | 'l-add'
  | 'l-opac'
  | 'l-dupl'
  | 'l-rm'
  | 'l-ren'
  | 'l-vis'
  | 'l-clip'
  | 'l-move'
  | 'l-merge'
  | 'l-merge-all'
  | 'l-erase'
  | 'rotate'
  | 'flood-fill'
  | 'shape'
  | 'grad'
  | 'text'
  | 'set-mixmode'
  | 'selection'
  | 'selection-transform'
  | 'selection-transform-clone'
  | 'selection-warp'
  | 'filter';

/**
 * Replay:
 * These events are ignored/skipped when calculating undo operations.
 * Note: undo will just "remove" the previous event from the whole list,
 * so an undone-event will never appear in the replay animation.
 * Event types defined here are "not undoable" so they will remain in the animation.
 * The undo-operation will affect the event prior to the ignored event (aka skip).
 */
export const UNDO_IGNORED_EVENTS: TEventType[] = [
  // The end of a paper's setup (the reset and the initial layers). Not an action of the user:
  // live, undo stops there (the history is rebased), so no recorded undo ever means it.
  'setup-done',
];

/**
 * How a regular event joins the undo steps before it, `topStep` being the events of the last step
 * (`undefined` if there is none):
 * - 'own': it is a step of its own - an undo takes it alone
 * - 'joins': it is part of the last step - an undo takes both (and a redo brings both back)
 * - 'cancels': it undid the last step - neither is a step any more; their events stay in the
 *   replay (together they change nothing), the next undo takes the step before
 *
 * Klecks lets an opacity or visibility change replace the history entry before it when that
 * changed the same thing of the same layer: two moves of the opacity slider are one undo step, a
 * layer hidden and shown again is none. The recorder recorded every one of them as an event of
 * its own until it learned to follow (KlCanvas.pushReplacingStep): papers from before carry the
 * events, and the replay has to take the steps the history took. An event recorded since says
 * so with a third element `true` - it is a step of its own, whatever comes before.
 *
 * (Repeated nowhere: the replayer and the administration's event viewer both ask this.)
 */
export function joinUndoStep(
  topStep: readonly Pick<TRecordedEvent, 'type' | 'data'>[] | undefined,
  event: Pick<TRecordedEvent, 'type' | 'data'>
): 'own' | 'joins' | 'cancels' {
  if (event.type !== 'l-opac' && event.type !== 'l-vis') return 'own';
  const isOlderEvent = (e: Pick<TRecordedEvent, 'type' | 'data'>) =>
    e.type === event.type && Array.isArray(e.data) && e.data[2] !== true;
  const first = topStep?.[0];
  if (!first || !isOlderEvent(event) || !isOlderEvent(first) || first.data[0] !== event.data[0]) return 'own';
  // Hiding or showing is only recorded as a change: the second of two on one layer goes back to
  // where the first started, which the history found to be no change at all. (An opacity slider
  // moved back to where it started did the same - the events do not say where that was.)
  if (event.type === 'l-vis' && event.data[1] !== first.data[1]) return 'cancels';
  return 'joins';
}

/**
 * Event structure
 */
export type TRecordedEvent = {
  projectId: string;
  sequenceNumber: number;
  timestamp: number;
  type: TEventType;
  data: any;
};

/**
 * Parameter type for getEvents
 */
export type TGetEventsOptions = {
  fromSequence?: number;
  toSequence?: number;
  includeTypes?: TEventType[];
};

/**
 * Statistics about the replay process.
 * Return type of the replay() function
 */
export type TReplayStats = {
  totalEvents: number;
  processedEvents: number;
  skippedEvents: number;
  actualDuration: number;
  targetDuration?: number;
  averageFps: number;
};

/**
 * Events from the DrawChain are "compressed" into a small string (this type) to
 * save in memory and bandwidth.
 */
export type TSanitizedDrawEvent = string;

/**
 * Callback type for when an event is recorded.
 * Used for invoking third party systems like APIs
 */
export type TEventRecordedCallback = (event: TRecordedEvent, totalTime: number) => void;

/**
 * Event handler for replaying specific typed event.
 * These handlers should perform the actions required to draw/apply an event to a canvas,
 * aka the replay-action.
 */
export type TEventReplayingHandler = (event: TRecordedEvent) => void | Promise<void>;

/**
 * Recorder:
 * When two events occur within this timespan, the actual time gets added to the "time taken" counter
 */
export const TIMESPAN_ACCUMULATION_MS = 3000;

export const DEBUG_RECORDER = true;
export const DEBUG_REPLAYER = true;
export const LOG_STYLE_REPLAYER = 'color: #6AA6FF; font-weight: bold;';
export const LOG_STYLE_RECORDER = 'color: orange; font-weight: bold;';
