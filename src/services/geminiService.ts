import { GoogleGenAI, Type, ThinkingLevel } from "@google/genai";
import { BoardState, Player, Position, Move, Difficulty } from "../types";

const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY! });

export async function getAIMove(
  board: BoardState,
  turn: Player,
  goatsToPlace: number,
  goatsCaptured: number,
  difficulty: Difficulty = 'MEDIUM'
): Promise<Move | null> {
  const boardStr = board.map(row => row.map(cell => cell || '.').join(' ')).join('\n');
  
  const difficultyInstructions = {
    EASY: "You are a beginner Bagh-Chal player. Make a simple, legal move. Don't think too far ahead. Just try to move a piece to an empty adjacent spot or place a goat in a reasonable position.",
    MEDIUM: "You are an intermediate Bagh-Chal player. Look for basic tactical opportunities. If you are a Tiger, try to capture goats. If you are a Goat, try to protect your pieces and slowly surround the tigers.",
    HARD: "You are a Grandmaster Bagh-Chal player. Perform a deep strategic analysis of the board. Anticipate your opponent's responses for the next 3-4 moves. If you are a Tiger, set up double-threats, force captures, and control the center. Prioritize moves that limit the goats' ability to form a solid wall. If you are a Goat, execute a perfect 'trap' formation to immobilize the tigers efficiently, prioritizing blocking tiger jump paths and maintaining a connected structure to prevent isolated captures."
  };

  const prompt = `
    ${difficultyInstructions[difficulty]}
    
    Bagh-Chal is a strategy board game from Nepal played on a 5x5 grid.
    
    Current Board State (5x5):
    ${boardStr}
    
    Current Turn: ${turn}
    Goats remaining to place: ${goatsToPlace}
    Goats captured by tigers: ${goatsCaptured}
    
    Rules:
    - Tigers (T) win by capturing 5 goats.
    - Goats (G) win by trapping all 4 tigers.
    - Goats must be placed one by one until 20 are on the board.
    - Tigers can move to adjacent spots or jump over a goat to an empty spot to capture it.
    - Goats can only move to adjacent spots after all 20 are placed.
    - Diagonal moves are only allowed if (x + y) is even.
    
    Your task:
    1. Analyze the board deeply.
    2. If you are GOAT and goatsToPlace > 0, return a PLACE move with 'to' coordinates.
    3. If you are GOAT and goatsToPlace == 0, return a MOVE move with 'from' and 'to' coordinates.
    4. If you are TIGER, return a MOVE or CAPTURE move with 'from' and 'to' coordinates.
    
    Coordinates are 0-indexed (x, y) where (0,0) is top-left.
    
    Return the move in JSON format. Provide a detailed 'thought' process explaining your strategy, especially for HARD difficulty.
  `;

  const thinkingLevel = difficulty === 'HARD' ? ThinkingLevel.HIGH : 
                       difficulty === 'MEDIUM' ? ThinkingLevel.LOW : 
                       ThinkingLevel.MINIMAL;

  try {
    const response = await ai.models.generateContent({
      model: "gemini-3-flash-preview",
      contents: prompt,
      config: {
        thinkingConfig: { thinkingLevel },
        responseMimeType: "application/json",
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            from: {
              type: Type.OBJECT,
              properties: {
                x: { type: Type.INTEGER },
                y: { type: Type.INTEGER }
              }
            },
            to: {
              type: Type.OBJECT,
              properties: {
                x: { type: Type.INTEGER },
                y: { type: Type.INTEGER }
              },
              required: ["x", "y"]
            },
            type: {
              type: Type.STRING,
              enum: ["PLACE", "MOVE", "CAPTURE"]
            },
            thought: { type: Type.STRING, description: "Detailed strategic reasoning for the move." },
            reasoning: { type: Type.STRING, description: "Short explanation of the move." }
          },
          required: ["to", "type"]
        }
      }
    });

    const move = JSON.parse(response.text);
    return move as Move;
  } catch (error) {
    console.error("Error getting AI move:", error);
    return null;
  }
}
