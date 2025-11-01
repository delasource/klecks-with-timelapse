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
}
