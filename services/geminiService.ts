
import { GoogleGenAI, Type, Modality } from "@google/genai";
import { Script, StoryElements } from '../types';

if (!process.env.API_KEY) {
    throw new Error("API_KEY environment variable not set");
}
  
const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });
const CORS_PROXY = 'https://api.allorigins.win/raw?url=';

function getDailyVariable(): string {
    const dayMap: { [key: string]: string } = {
        "Sunday": "28", "Monday": "27", "Tuesday": "21", "Wednesday": "22",
        "Thursday": "18", "Friday": "24", "Saturday": "25"
    };
    const now = new Date();
    // PST is UTC-8. We subtract 8 hours from the current UTC time to get the correct day.
    const pstDate = new Date(now.getTime() - 8 * 60 * 60 * 1000);
    const dayIndex = pstDate.getUTCDay(); // 0 = Sunday, 1 = Monday, etc.
    const dayNames = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
    return dayMap[dayNames[dayIndex]] || "22"; // Default to Wednesday's '22' if lookup fails
}

async function fetchDescriptionFromRSS(url: string): Promise<string> {
    try {
        const response = await fetch(`${CORS_PROXY}${encodeURIComponent(url)}`);
        if (!response.ok) {
            throw new Error(`Network response was not ok, status: ${response.status}`);
        }
        const xmlText = await response.text();
        
        const parser = new DOMParser();
        const xmlDoc = parser.parseFromString(xmlText, 'application/xml');

        const parserError = xmlDoc.querySelector('parsererror');
        if (parserError) {
            console.error('XML Parsing Error:', parserError.textContent);
            throw new Error('Failed to parse the RSS feed XML.');
        }

        const items = xmlDoc.querySelectorAll('item');
        if (!items || items.length === 0) {
            throw new Error('No <item> elements found in the RSS feed.');
        }

        for (const item of items) {
            const descriptionNode = item.querySelector('description');
            if (descriptionNode && descriptionNode.textContent) {
                const htmlContent = descriptionNode.textContent;
                const tempDiv = document.createElement('div');
                tempDiv.innerHTML = htmlContent;
                const potentialSeed = (tempDiv.textContent || tempDiv.innerText || "").trim();
                
                const isURL = potentialSeed.startsWith('http://') || potentialSeed.startsWith('https://');
                if (potentialSeed && !isURL && potentialSeed.length > 20) {
                    return potentialSeed; 
                }
            }
        }
        throw new Error('No valid story seed found in any of the RSS items.');
    } catch (error) {
        console.error(`Error fetching from ${url}:`, error);
        throw new Error(`Could not fetch or parse from ${url}. The source might be unavailable or blocked.`);
    }
}


export async function fetchStoryElements(): Promise<StoryElements> {
    const x = getDailyVariable();
    
    const feedUrls = {
        characters: `https://www.htmlcommentbox.com/rss_clean?page=https%3A%2F%2Fvgy.rf.gd%2F${x}%2F%3Fi%3Dcharacters&opts=16798&mod=$1$wq1rdBcg$ir4fsMQfu76bjx/maFJMv/`,
        story: `https://www.htmlcommentbox.com/rss_clean?page=https%3A%2F%2Fvgy.rf.gd%2F${x}%2F%3Fi%3Dstory&opts=16798&mod=$1$wq1rdBcg$ir4fsMQfu76bjx/maFJMv/`,
        today: `https://www.htmlcommentbox.com/rss_clean?page=https%3A%2F%2Fvgy.rf.gd%2F${x}%2F%3Fi%3Dtoday&opts=16798&mod=$1$wq1rdBcg$ir4fsMQfu76bjx/maFJMv/`
    };

    const feedNames = Object.keys(feedUrls) as (keyof typeof feedUrls)[];
    const promises = feedNames.map(name => fetchDescriptionFromRSS(feedUrls[name]));
    
    const results = await Promise.allSettled(promises);

    const successfulResults: Partial<StoryElements> = {};
    const failedFeeds: string[] = [];

    results.forEach((result, index) => {
        const feedName = feedNames[index];
        if (result.status === 'fulfilled') {
            successfulResults[feedName] = result.value;
        } else {
            const reason = result.reason instanceof Error ? result.reason.message : String(result.reason);
            console.error(`Error fetching '${feedName}' feed:`, reason);
            failedFeeds.push(`'${feedName.charAt(0).toUpperCase() + feedName.slice(1)}' feed: ${reason}`);
        }
    });

    if (failedFeeds.length > 0) {
        const detailedErrorMessage = `Could not fetch all story elements. Please check your connection or try again later. \n\nFailed feeds:\n- ${failedFeeds.join('\n- ')}`;
        throw new Error(detailedErrorMessage);
    }
    
    return successfulResults as StoryElements;
}

export function constructFinalPrompt(storyElements: StoryElements, inspirationalEvent: string): string {
    return `You are a creative writer for a sci-fi comedy series. Your task is to write a new short movie script based on a series premise and a user-provided event.

**Series Premise:**
---
**Characters:**
${storyElements.characters}

**Core Story:**
${storyElements.story}

**Daily Theme:**
${storyElements.today}
---

**Inspirational Event (Provided by User):**
---
${inspirationalEvent}
---

Weave the essence of this user-provided event into your story. It should serve as the central conflict or comedic situation for the episode. How would the characters from your Series Premise react to or cause a situation like this?

The final output must be a creative and engaging movie script. Return ONLY the JSON object conforming to the provided schema. Do not include any markdown formatting or any other text outside the JSON structure.
`;
}


const scriptSchema = {
    type: Type.OBJECT,
    properties: {
        source_file: { type: Type.STRING },
        title: { type: Type.STRING },
        scene_elements: {
            type: Type.ARRAY,
            items: {
                type: Type.OBJECT,
                properties: {
                    type: { type: Type.STRING, enum: ['scene_heading', 'action', 'dialogue_block', 'transition'] },
                    content: { type: Type.STRING, nullable: true },
                    character: { type: Type.STRING, nullable: true },
                    elements: {
                        type: Type.ARRAY,
                        nullable: true,
                        items: {
                            type: Type.OBJECT,
                            properties: {
                                type: { type: Type.STRING, enum: ['parenthetical', 'dialogue'] },
                                content: { type: Type.STRING }
                            },
                            required: ['type', 'content']
                        }
                    }
                },
                required: ['type']
            }
        }
    },
    required: ['source_file', 'title', 'scene_elements']
};


export async function generateStory(finalPrompt: string): Promise<Script> {
    try {
        const response = await ai.models.generateContent({
            model: "gemini-2.5-pro",
            contents: finalPrompt,
            config: {
                responseMimeType: "application/json",
                responseSchema: scriptSchema,
            },
        });
        
        const scriptJson = response.text;
        if (!scriptJson) {
            throw new Error("The model did not return a script.");
        }
        return JSON.parse(scriptJson) as Script;

    } catch (error) {
        console.error("Error generating story:", error);
        throw new Error("Could not generate a story. The model might have returned an invalid response or malformed JSON.");
    }
}

export async function createImagePromptFromAction(character: string, action: string): Promise<string> {
    try {
        const prompt = `Based on the following movie script action, create a short, visually descriptive prompt for an AI image generator. The prompt should be a single sentence. Focus on the character, the setting, and the key action. Do not include the character's name directly, instead use descriptive terms. Do not include dialogue cues or parentheticals.

        **Character:** ${character}
        **Action:** "${action}"
        
        **Example Input:**
        Character: URSULA
        Action: "URSULA (60s, grandmotherly but with a manic glint in her eye) pilots a UFO over Hollywood, spraying a mysterious gas from a large nozzle."
        **Example Output:**
        "An elderly woman with a wild look in her eyes pilots a flying saucer over the Hollywood sign, a thick green gas spraying from a nozzle onto the city below."`;

        const response = await ai.models.generateContent({
            model: 'gemini-2.5-flash',
            contents: prompt,
        });

        return response.text.trim();
    } catch (error) {
        console.error("Error creating image prompt:", error);
        // Fallback to a simpler prompt if the summarization fails
        return `${character} ${action}`;
    }
}


export async function generateImage(prompt: string, characterImageBase64?: string, mimeType?: string): Promise<string> {
    try {
        const parts: any[] = [];

        if (characterImageBase64 && mimeType) {
            parts.push({
                inlineData: {
                    data: characterImageBase64,
                    mimeType: mimeType,
                },
            });
        }
        parts.push({ text: `${prompt}. Cinematic, 16:9 aspect ratio.` });


        const response = await ai.models.generateContent({
            model: 'gemini-2.5-flash-image',
            contents: {
                parts: parts,
            },
            config: {
                responseModalities: [Modality.IMAGE],
            },
        });

        for (const part of response.candidates[0].content.parts) {
            if (part.inlineData) {
                return part.inlineData.data; // base64 string
            }
        }
        throw new Error("No image data found in the response.");

    } catch(error) {
        console.error("Error generating image:", error);
        const errorMessage = error instanceof Error ? error.message : String(error);
        throw new Error(`Failed to generate image for prompt: "${prompt}". Reason: ${errorMessage}`);
    }
}

export async function generateSpeech(text: string, voiceName: string): Promise<string> {
    try {
        const response = await ai.models.generateContent({
            model: "gemini-2.5-flash-preview-tts",
            contents: [{ parts: [{ text }] }],
            config: {
                responseModalities: [Modality.AUDIO],
                speechConfig: {
                    voiceConfig: {
                        prebuiltVoiceConfig: { voiceName },
                    },
                },
            },
        });
        const audioData = response.candidates?.[0]?.content?.parts?.[0]?.inlineData?.data;
        if (!audioData) {
            throw new Error("No audio data returned from TTS API.");
        }
        return audioData; // base64 string of raw PCM data
    } catch (error) {
        console.error(`Error generating speech for text "${text}" with voice ${voiceName}:`, error);
        throw new Error(`Failed to generate speech for text: "${text}"`);
    }
}
