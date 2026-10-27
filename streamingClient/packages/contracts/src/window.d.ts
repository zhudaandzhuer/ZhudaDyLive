import type { GameBridge, StudioBridge } from './index';
declare global {
  interface Window {
    studio: StudioBridge;
    sceneOutput: {
      reportSourceError(id: string, message: string): Promise<void>;
      snapshot(): Promise<import('./scenes').SceneSnapshot>;
      subscribe(callback: (state: import('./scenes').SceneSnapshot) => void): () => void;
    };
    zhudaGame: GameBridge;
  }
}
