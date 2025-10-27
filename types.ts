export interface GroundingChunk {
  web?: {
    uri: string;
    title: string;
  };
  maps?: {
    uri:string;
    title: string;
    placeAnswerSources?: {
      reviewSnippets: {
        uri: string;
        title: string;
      }[];
    }
  };
}


export type SceneElementType = 'scene_heading' | 'action' | 'dialogue_block' | 'transition';

export interface BaseSceneElement {
  type: SceneElementType;
  content?: string;
}

export interface DialogueBlock extends BaseSceneElement {
  type: 'dialogue_block';
  character: string;
  elements: {
      type: 'parenthetical' | 'dialogue';
      content: string;
  }[];
}

export interface SceneHeading extends BaseSceneElement {
    type: 'scene_heading';
    content: string;
}

export interface Action extends BaseSceneElement {
    type: 'action';
    content: string;
}

export interface Transition extends BaseSceneElement {
    type: 'transition';
    content: string;
}

export type SceneElement = SceneHeading | Action | DialogueBlock | Transition;

export interface Script {
  source_file: string;
  title: string;
  scene_elements: SceneElement[];
}

export interface GeneratedAudio {
    sceneIndex: number;
    audioBlob: Blob;
    duration: number; // in seconds
    character: string;
    dialogue: string;
}

export interface StoryElements {
    characters: string;
    story: string;
    today: string;
}