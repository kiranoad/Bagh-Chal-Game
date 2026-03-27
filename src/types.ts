export type Player = 'TIGER' | 'GOAT';
export type Difficulty = 'EASY' | 'MEDIUM' | 'HARD';

export interface Position {
  x: number;
  y: number;
}

export type BoardState = (Player | null)[][];

export interface Move {
  from?: Position;
  to: Position;
  type: 'PLACE' | 'MOVE' | 'CAPTURE';
  thought?: string;
  reasoning?: string;
}

export interface GameState {
  board: BoardState;
  turn: Player;
  goatsToPlace: number;
  goatsCaptured: number;
  winner: Player | null;
  selectedPiece: Position | null;
  validMoves: Position[];
}
