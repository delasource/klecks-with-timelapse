import { TBooleanOperation, TSelectShape } from '../klecks/select-tool/select-tool';

/**
 * Interface defining all methods that can be triggered externally
 * (equivalent to button clicks in the UI)
 */
export interface IHeadlessSelectActions {
  // Mode operations
  setSelectMode(): void;
  setTransformMode(): boolean; // returns if transformation is possible

  // Selection operations
  setSelectionShape(shape: TSelectShape): void;
  resetSelection(): void;
  selectAll(): void;
  invertSelection(): void;
  setBooleanOperation(operation: TBooleanOperation): void;

  // Transform operations
  flipHorizontal(): void;
  flipVertical(): void;
  rotate(degrees: number): void;
  clone(): void;
  // true (the default): dragging a corner handle keeps the proportions
  setConstrained(isConstrained: boolean): void;
  // true (the default): the handles snap to the edges of the drawing and to every 45°
  setSnapping(isSnapping: boolean): void;
  // a lattice over what is transformed, to drag it out of shape. returns whether it is warping now
  setWarping(isWarping: boolean): boolean;

  // Layer operations
  moveToLayer(layerIndex: number): void;

  // Background operations
  setTransparentBackground(isTransparent: boolean): void;

  // Tool operations
  erase(): void;
  fill(): void;

  // History operations
  commitTransform(): boolean; // returns if changes were applied
  discardTransform(): boolean; // returns if transformation was active

  // State getters
  getCurrentMode(): 'select' | 'transform';
  getState(): IHeadlessSelectState;
}

/**
 * Selection state information
 */
export interface IHeadlessSelectState {
  mode: 'select' | 'transform';
  hasSelection: boolean;
  selectionShape: TSelectShape;
  booleanOperation: TBooleanOperation;
  targetLayerIndex: number;
  backgroundIsTransparent: boolean;
  canTransform: boolean;
  isCloning: boolean;
  isConstrained: boolean;
  isSnapping: boolean;
  // the lattice of a warp is on the canvas and can be dragged
  isWarping: boolean;
  // the transformation has a warp (being dragged, or done and now moved as a whole)
  hasWarp: boolean;
}
