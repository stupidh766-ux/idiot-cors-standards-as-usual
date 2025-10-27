
import React, { useState, useCallback, useEffect } from 'react';
import JSZip from 'jszip';
import { generateStory, fetchStoryElements, constructFinalPrompt, generateImage, generateSpeech, createImagePromptFromAction } from './services/geminiService';
import { Script, DialogueBlock, GeneratedAudio, StoryElements } from './types';
import Button from './components/Button';

type GeneratedImage = { sceneIndex: number; imageUrl: string };
type CharacterImage = { file: File; base64: string; mimeType: string };

const MALE_VOICES = ['Puck', 'Charon', 'Fenrir', 'Zephyr'];
const FEMALE_VOICES = ['Kore'];
const SAMPLE_RATE = 24000;

// Helper function to decode base64 string to Uint8Array
const decode = (base64: string): Uint8Array => {
    const binaryString = atob(base64);
    const len = binaryString.length;
    const bytes = new Uint8Array(len);
    for (let i = 0; i < len; i++) {
        bytes[i] = binaryString.charCodeAt(i);
    }
    return bytes;
};

// Helper function to convert raw PCM data to a WAV file blob
const pcmToWav = (pcmData: Uint8Array, sampleRate: number, numChannels: number, bitsPerSample: number): Blob => {
    const byteRate = sampleRate * numChannels * (bitsPerSample / 8);
    const blockAlign = numChannels * (bitsPerSample / 8);
    const dataSize = pcmData.length;
    const fileSize = 36 + dataSize;
    
    const buffer = new ArrayBuffer(44);
    const view = new DataView(buffer);

    // RIFF header
    view.setUint32(0, 0x52494646, false); // "RIFF"
    view.setUint32(4, fileSize, true);
    view.setUint32(8, 0x57415645, false); // "WAVE"
    // "fmt " sub-chunk
    view.setUint32(12, 0x666d7420, false); // "fmt "
    view.setUint32(16, 16, true); // Sub-chunk size
    view.setUint16(20, 1, true); // Audio format (1 for PCM)
    view.setUint16(22, numChannels, true);
    view.setUint32(24, sampleRate, true);
    view.setUint32(28, byteRate, true);
    view.setUint16(32, blockAlign, true);
    view.setUint16(34, bitsPerSample, true);
    // "data" sub-chunk
    view.setUint32(36, 0x64617461, false); // "data"
    view.setUint32(40, dataSize, true);

    return new Blob([view, pcmData], { type: 'audio/wav' });
};


const DownloadIcon: React.FC = () => (
    <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className="w-5 h-5">
        <path strokeLinecap="round" strokeLinejoin="round" d="M3 16.5v2.25A2.25 2.25 0 0 0 5.25 21h13.5A2.25 2.25 0 0 0 21 18.75V16.5M16.5 12 12 16.5m0 0L7.5 12m4.5 4.5V3" />
    </svg>
);

const SparklesIcon: React.FC = () => (
    <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className="w-5 h-5">
        <path strokeLinecap="round" strokeLinejoin="round" d="m16.862 4.487 1.687-1.688a1.875 1.875 0 1 1 2.652 2.652L10.582 16.07a4.5 4.5 0 0 1-1.897 1.13L6 18l.8-2.685a4.5 4.5 0 0 1 1.13-1.897l8.932-8.931Zm0 0L19.5 7.125M18 14v4.75A2.25 2.25 0 0 1 15.75 21H5.25A2.25 2.25 0 0 1 3 18.75V8.25A2.25 2.25 0 0 1 5.25 6H10" />
    </svg>
);

const App: React.FC = () => {
    const [isProcessing, setIsProcessing] = useState<boolean>(false);
    const [statusMessage, setStatusMessage] = useState<string>('');
    const [error, setError] = useState<string | null>(null);

    const [userInput, setUserInput] = useState<string>(() => localStorage.getItem('userInput') || '');
    const [storyElements, setStoryElements] = useState<StoryElements | null>(null);
    const [scriptData, setScriptData] = useState<Script | null>(null);
    const [generatedImages, setGeneratedImages] = useState<GeneratedImage[]>([]);
    const [generatedAudio, setGeneratedAudio] = useState<GeneratedAudio[]>([]);
    const [characterImages, setCharacterImages] = useState<Record<string, CharacterImage>>({});

    useEffect(() => {
        localStorage.setItem('userInput', userInput);
    }, [userInput]);
    
    const handleCharacterImageUpload = useCallback(async (event: React.ChangeEvent<HTMLInputElement>) => {
        const files = event.target.files;
        if (!files || files.length === 0) return;
        setIsProcessing(true);
        setStatusMessage(`Reading ${files.length} image(s)...`);
        try {
            const newImages: Record<string, CharacterImage> = {};
            const promises = Array.from(files).map((file: File) => {
                return new Promise<void>((resolve, reject) => {
                    const reader = new FileReader();
                    reader.onload = (e) => {
                        const characterName = file.name.split('.').slice(0, -1).join('.').toLowerCase();
                        if (e.target?.result && characterName) {
                            newImages[characterName] = {
                                file,
                                mimeType: file.type,
                                base64: (e.target.result as string).split(',')[1]
                            };
                        }
                        resolve();
                    };
                    reader.onerror = reject;
                    reader.readAsDataURL(file);
                });
            });
            await Promise.all(promises);
            setCharacterImages(prev => ({ ...prev, ...newImages }));
        } catch (err) {
            setError("Failed to read image files.");
        } finally {
            setIsProcessing(false);
            setStatusMessage('');
            event.target.value = ''; 
        }
    }, []);

    const handleFetchPremise = useCallback(async () => {
        if (!userInput.trim()) {
            setError('Please provide a story idea to get started.');
            return;
        }
        setIsProcessing(true);
        setError(null);
        setStoryElements(null);
        setStatusMessage("Fetching today's story premise...");
        try {
            const elements = await fetchStoryElements();
            setStoryElements(elements);
        } catch (err) {
            const errorMessage = err instanceof Error ? err.message : 'An unknown error occurred while fetching the premise.';
            setError(errorMessage);
            console.error("Fetch Premise Error:", err);
        } finally {
            setIsProcessing(false);
            setStatusMessage('');
        }
    }, [userInput]);

    const handleGenerate = useCallback(async () => {
        if (!userInput.trim()) {
            setError('Please provide a story idea to get started.');
            return;
        }
        if (!storyElements) {
            setError('Story premise not loaded. Please fetch it first.');
            return;
        }
    
        setIsProcessing(true);
        setError(null);
        setScriptData(null);
        setGeneratedImages([]);
        setGeneratedAudio([]);
        
        try {
            // 1. Fetch Story Elements (already done in handleFetchPremise)
    
            // 2. Construct Prompt
            setStatusMessage('Constructing story prompt...');
            const finalPrompt = constructFinalPrompt(storyElements, userInput);

            // 3. Generate Script
            setStatusMessage('Generating movie script...');
            const script = await generateStory(finalPrompt);
            setScriptData(script);
    
            // 4. Generate Images
            const scenesWithAction = script.scene_elements
                .map((el, index) => ({ el, index }))
                .filter(({ el }) => el.type === 'action' && el.content);
    
            let lastCharacter = 'A character';
            const images: GeneratedImage[] = [];
            for (let i = 0; i < scenesWithAction.length; i++) {
                const { el: actionElement, index: sceneIndex } = scenesWithAction[i];
                const precedingElements = script.scene_elements.slice(0, sceneIndex);
                const lastDialogue = precedingElements.filter(el => el.type === 'dialogue_block').pop() as DialogueBlock | undefined;
                if (lastDialogue) lastCharacter = lastDialogue.character;
                
                setStatusMessage(`Creating image prompt ${i + 1} of ${scenesWithAction.length}...`);
                const characterImage = characterImages[lastCharacter.toLowerCase().trim()];
                const imagePromptText = await createImagePromptFromAction(lastCharacter, actionElement.content || '');
                const finalImagePrompt = characterImage 
                    ? `Use the character from the input image. Place them in this scene, matching the existing art style: ${imagePromptText}`
                    : imagePromptText;

                setStatusMessage(`Generating image ${i + 1} of ${scenesWithAction.length}...`);
                const imageBase64 = await generateImage(finalImagePrompt, characterImage?.base64, characterImage?.mimeType);
                images.push({
                    sceneIndex,
                    imageUrl: `data:image/png;base64,${imageBase64}`
                });
            }
            setGeneratedImages(images);
    
            // 5. Generate Audio
            const dialogueBlocks = script.scene_elements
                .map((el, index) => ({ el, index }))
                .filter(({el}) => el.type === 'dialogue_block') as {el: DialogueBlock, index: number}[];
    
            const characterVoices: Record<string, string> = {};
            const assignedGenders: Record<string, 'male' | 'female'> = {};
            let maleVoiceIndex = 0;
            let femaleVoiceIndex = 0;
    
            setStatusMessage('Assigning voices to characters...');
            dialogueBlocks.forEach(({el}) => {
                const characterName = el.character;
                if (!characterVoices[characterName]) {
                    // Try to determine gender only once per character
                    if (!assignedGenders[characterName]) {
                        const genderRegex = new RegExp(`\\b${characterName}\\b\\s*\\((m|f)\\)`, 'i');
                        const match = storyElements.characters.match(genderRegex);
                        if (match) {
                            assignedGenders[characterName] = match[1].toLowerCase() === 'm' ? 'male' : 'female';
                        }
                    }
                    
                    const gender = assignedGenders[characterName];
            
                    if (gender === 'female' && FEMALE_VOICES.length > 0) {
                        characterVoices[characterName] = FEMALE_VOICES[femaleVoiceIndex % FEMALE_VOICES.length];
                        femaleVoiceIndex++;
                    } else { // Default to male if gender is 'male', undefined, or no female voices available
                        characterVoices[characterName] = MALE_VOICES[maleVoiceIndex % MALE_VOICES.length];
                        maleVoiceIndex++;
                    }
                }
            });
    
            const audioClips: GeneratedAudio[] = [];
            for(let i = 0; i < dialogueBlocks.length; i++) {
                const { el, index } = dialogueBlocks[i];
                setStatusMessage(`Generating audio for ${el.character.toUpperCase()} (${i + 1}/${dialogueBlocks.length})...`);
                
                const dialogueText = el.elements.find(e => e.type === 'dialogue')?.content || '';
                if (!dialogueText) continue;

                const parenthetical = el.elements.find(e => e.type === 'parenthetical')?.content;
                const promptText = parenthetical ? `(speaking in a ${parenthetical} tone) ${dialogueText}` : dialogueText;
                
                const audioBase64 = await generateSpeech(promptText, characterVoices[el.character]);
                const pcmData = decode(audioBase64);
                const audioBlob = pcmToWav(pcmData, SAMPLE_RATE, 1, 16);
                const duration = pcmData.length / (SAMPLE_RATE * 2); 
                audioClips.push({ sceneIndex: index, audioBlob, duration, character: el.character, dialogue: dialogueText });
            }
            setGeneratedAudio(audioClips);
    
        } catch (err) {
            const errorMessage = err instanceof Error ? err.message : 'An unknown error occurred during asset generation.';
            setError(errorMessage);
            console.error("Asset Generation Error:", err);
        } finally {
            setIsProcessing(false);
            setStatusMessage('');
        }
    }, [userInput, characterImages, storyElements]);

    const handleStartOver = () => {
        setScriptData(null);
        setGeneratedImages([]);
        setGeneratedAudio([]);
        setCharacterImages({});
        setUserInput('');
        setError(null);
        setStatusMessage('');
        setIsProcessing(false);
        setStoryElements(null);
        localStorage.removeItem('userInput');
    };
    
    const scriptToText = (script: Script | null): string => {
        if (!script) return "";
        let text = `Title: ${script.title}\n\n`;
        script.scene_elements.forEach(el => {
            switch(el.type) {
                case 'scene_heading': text += `${el.content}\n\n`; break;
                case 'action': text += `${el.content}\n\n`; break;
                case 'transition': text += `${el.content}\n\n`; break;
                case 'dialogue_block':
                    if ('character' in el && 'elements' in el) {
                       text += `\t${el.character.toUpperCase()}\n`;
                        el.elements.forEach(diag => {
                           text += diag.type === 'parenthetical' ? `\t(${diag.content})\n` : `\t${diag.content}\n`;
                        });
                        text += '\n'; 
                    }
                    break;
            }
        });
        return text;
    };

    const handleDownloadZip = async () => {
        if (!scriptData) return;
        setIsProcessing(true);
        setStatusMessage('Packaging files for download...');
        setError(null);
        try {
            const zip = new JSZip();
            zip.file('script.json', JSON.stringify(scriptData, null, 2));
            zip.file('story.txt', scriptToText(scriptData));
            
            const imageFolder = zip.folder("images");
            if (imageFolder) {
                 for(let i = 0; i < generatedImages.length; i++) {
                    const img = generatedImages[i];
                    const fileName = `${String(img.sceneIndex).padStart(4, '0')}.png`;
                    imageFolder.file(fileName, img.imageUrl.split(',')[1], {base64: true});
                }
            }

            const audioFolder = zip.folder("audio");
            if (audioFolder && generatedAudio.length > 0) {
                for(let i = 0; i < generatedAudio.length; i++) {
                    const audio = generatedAudio[i];
                    const fileName = `${String(audio.sceneIndex).padStart(4, '0')}.wav`;
                    audioFolder.file(fileName, audio.audioBlob);
                }
            }

            const content = await zip.generateAsync({ type: 'blob' });
            const link = document.createElement('a');
            link.href = URL.createObjectURL(content);
            const safeTitle = scriptData.title.replace(/[^a-z0-9]/gi, '_').toLowerCase();
            link.download = `${safeTitle}_assets.zip`;
            document.body.appendChild(link);
            link.click();
            document.body.removeChild(link);
            URL.revokeObjectURL(link.href);

        } catch (err) {
            const errorMessage = err instanceof Error ? err.message : String(err);
            setError(`Failed to create zip file: ${errorMessage}`);
        } finally {
            setIsProcessing(false);
            setStatusMessage('');
        }
    };

    const renderInitialForm = () => (
        <div className="text-center animate-fade-in">
            <h2 className="text-2xl font-bold mb-4">What's the story?</h2>
            <p className="mb-6 text-slate-400">Enter a single event or idea. This will be woven into a new story based on today's premise.</p>
            
            <textarea
                value={userInput}
                onChange={(e) => setUserInput(e.target.value)}
                placeholder="e.g., A celebrity accidentally launches a car into orbit."
                className="w-full max-w-lg p-3 bg-slate-900 border border-slate-600 rounded-md focus:ring-2 focus:ring-sky-500 focus:outline-none transition text-slate-100 placeholder-slate-500"
                rows={3}
                disabled={isProcessing}
            />

            {storyElements && (
                 <div className="my-6 p-6 border border-slate-700 bg-slate-900/50 rounded-lg text-left animate-fade-in">
                    <h3 className="text-xl font-semibold mb-4 text-sky-400">Today's Premise</h3>
                    <div className="space-y-4">
                        <div>
                            <h4 className="font-bold text-slate-300">Characters:</h4>
                            <p className="text-sm text-slate-400 whitespace-pre-wrap">{storyElements.characters}</p>
                        </div>
                        <div>
                            <h4 className="font-bold text-slate-300">Core Story:</h4>
                            <p className="text-sm text-slate-400 whitespace-pre-wrap">{storyElements.story}</p>
                        </div>
                        <div>
                            <h4 className="font-bold text-slate-300">Daily Theme:</h4>
                            <p className="text-sm text-slate-400 whitespace-pre-wrap">{storyElements.today}</p>
                        </div>
                    </div>
                </div>
            )}
            
            <div className="my-8 p-6 border border-slate-700 bg-slate-800/50 rounded-lg">
                <h3 className="text-lg font-semibold mb-3 text-sky-400">Optional: Add Character Images</h3>
                <p className="text-sm text-slate-400 mb-4">
                    For character consistency, upload reference images. Name files after characters (e.g., "Ursula.png", "Captain Rex.jpg"). Case-insensitive.
                </p>
                <label htmlFor="image-upload" className="cursor-pointer inline-flex items-center justify-center px-6 py-3 border border-slate-600 text-base font-medium rounded-md shadow-sm text-slate-300 bg-slate-700 hover:bg-slate-600 transition-colors duration-200">
                    Upload Character Images
                </label>
                <input id="image-upload" type="file" multiple accept="image/*" className="hidden" onChange={handleCharacterImageUpload} disabled={isProcessing} />
                {Object.keys(characterImages).length > 0 && (
                    <div className="mt-6 text-left">
                        <h4 className="font-semibold mb-3">Uploaded Characters:</h4>
                        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-4">
                            {/* FIX: Use Object.keys to map over characterImages to ensure correct type inference. */}
                            {Object.keys(characterImages).map((name) => {
                                const img = characterImages[name];
                                return (
                                    <div key={name} className="p-2 bg-slate-700 rounded-md">
                                        <img src={URL.createObjectURL(img.file)} alt={name} className="w-full h-24 object-cover rounded-md" />
                                        <p className="text-xs text-center font-mono mt-2 truncate text-slate-300" title={name}>{name}</p>
                                    </div>
                                );
                            })}
                        </div>
                    </div>
                )}
            </div>

            {storyElements ? (
                <Button onClick={handleGenerate} isLoading={isProcessing} icon={<SparklesIcon />} className="mt-4">
                    Generate Storyboard
                </Button>
            ) : (
                <Button onClick={handleFetchPremise} isLoading={isProcessing} className="mt-4">
                    Fetch Today's Premise
                </Button>
            )}
        </div>
    );

    const renderResults = () => (
        <div className="animate-fade-in w-full">
            <h2 className="text-3xl font-bold mb-6 text-center">Your Story Is Ready!</h2>
            
            <div className="mb-8">
                 <h3 className="text-xl font-semibold mb-3">Generated Images</h3>
                 <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
                    {generatedImages.map((img, index) => (
                        <div key={index} className="bg-slate-800 p-2 rounded-lg shadow">
                            <img src={img.imageUrl} alt={`Generated scene ${index + 1}`} className="w-full h-auto rounded aspect-video object-cover" />
                            <p className="text-xs text-slate-400 mt-2 p-1">{scriptData?.scene_elements[img.sceneIndex]?.content}</p>
                        </div>
                    ))}
                </div>
            </div>

            <div className="mb-8">
                <h3 className="text-xl font-semibold mb-3">Generated Script (JSON)</h3>
                <pre className="p-4 my-4 whitespace-pre-wrap text-xs bg-slate-800 rounded-md text-slate-300 max-h-96 overflow-auto">
                    <code>{JSON.stringify(scriptData, null, 2)}</code>
                </pre>
            </div>

            <div className="text-center mt-8">
                 <Button onClick={handleDownloadZip} isLoading={isProcessing} icon={<DownloadIcon />}>
                    Download All Assets (.zip)
                </Button>
                 <Button onClick={handleStartOver} disabled={isProcessing} className="bg-slate-700 hover:bg-slate-600 ml-4">
                    Start Over
                </Button>
            </div>

        </div>
    );

    return (
        <main className="container mx-auto p-4 sm:p-8 flex flex-col items-center min-h-screen">
            <div className="w-full max-w-4xl text-center">
                <h1 className="text-4xl sm:text-5xl font-extrabold mb-2 bg-gradient-to-r from-sky-400 to-cyan-300 text-transparent bg-clip-text">HOT BOTTLE</h1>
                <p className="text-md sm:text-lg text-slate-400 mb-8">automatic storyboard generator</p>
            </div>
            
            <div className="w-full max-w-4xl p-6 sm:p-8 bg-slate-800/50 backdrop-blur-sm rounded-xl shadow-2xl border border-slate-700 flex flex-col items-center">
                {isProcessing && (
                     <div className="flex items-center justify-center gap-3 text-lg text-sky-300 p-4 mb-6 bg-sky-900/50 rounded-lg w-full animate-fade-in">
                        <svg className="animate-spin h-5 w-5 text-sky-300" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path></svg>
                        <span>{statusMessage || 'Processing...'}</span>
                    </div>
                )}
                {error && (
                    <div className="p-4 mb-6 text-center text-red-300 bg-red-900/50 border border-red-700 rounded-lg w-full animate-fade-in" role="alert">
                        <p className="font-bold">An Error Occurred</p>
                        <p className="text-sm">{error}</p>
                    </div>
                )}
                
                <div className="w-full">
                  {scriptData ? renderResults() : renderInitialForm()}
                </div>

            </div>
             <footer className="text-center mt-8 text-sm text-slate-500">
                <p>&copy; {new Date().getFullYear()} HOT BOTTLE. All rights reserved.</p>
            </footer>
        </main>
    );
};

export default App;
