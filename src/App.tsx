/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect, useCallback, useRef } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { Trophy, RotateCcw, Info, User, ShieldAlert, Cpu, UserCheck, Loader2, AlertCircle, Volume2, VolumeX, Brain, Sparkles, Users, Link, Copy, Check, Share2, X } from 'lucide-react';
import { Toaster, toast } from 'sonner';
import { Player, Position, BoardState, GameState, Move, Difficulty } from './types';
import { getAIMove } from './services/geminiService';
import { soundService } from './services/soundService';
import { io, Socket } from 'socket.io-client';
import { QRCodeSVG } from 'qrcode.react';

const BOARD_SIZE = 5;
const TOTAL_GOATS = 20;
const GOATS_TO_WIN = 5;

const INITIAL_BOARD: BoardState = Array(BOARD_SIZE).fill(null).map(() => Array(BOARD_SIZE).fill(null));
INITIAL_BOARD[0][0] = 'TIGER';
INITIAL_BOARD[0][4] = 'TIGER';
INITIAL_BOARD[4][0] = 'TIGER';
INITIAL_BOARD[4][4] = 'TIGER';

// Check if a move is valid based on the board's diagonal rules
const isAdjacent = (from: Position, to: Position) => {
  const dx = Math.abs(from.x - to.x);
  const dy = Math.abs(from.y - to.y);
  
  // Orthogonal move
  if ((dx === 1 && dy === 0) || (dx === 0 && dy === 1)) return true;
  
  // Diagonal move (only allowed if (x+y) is even)
  if (dx === 1 && dy === 1) {
    return (from.x + from.y) % 2 === 0;
  }
  
  return false;
};

export default function App() {
  const [game, setGame] = useState<GameState>({
    board: INITIAL_BOARD,
    turn: 'GOAT',
    goatsToPlace: TOTAL_GOATS,
    goatsCaptured: 0,
    winner: null,
    selectedPiece: null,
    validMoves: [],
  });

  const [showRules, setShowRules] = useState(false);
  const [aiPlayer, setAiPlayer] = useState<Player | 'NONE'>('NONE');
  const [difficulty, setDifficulty] = useState<Difficulty>('MEDIUM');
  const [isMuted, setIsMuted] = useState(false);
  const [isAILoading, setIsAILoading] = useState(false);
  const [capturedGoat, setCapturedGoat] = useState<{ x: number, y: number, id: number } | null>(null);
  const aiThinkingRef = useRef(false);
  const scoreRef = useRef<HTMLDivElement>(null);
  const boardRef = useRef<HTMLDivElement>(null);

  // Multiplayer State
  const [socket, setSocket] = useState<Socket | null>(null);
  const [roomId, setRoomId] = useState<string | null>(null);
  const [playerRole, setPlayerRole] = useState<Player | null>(null);
  const [isMultiplayer, setIsMultiplayer] = useState(false);
  const [showJoinModal, setShowJoinModal] = useState(false);
  const [inputRoomId, setInputRoomId] = useState('');
  const [copied, setCopied] = useState(false);
  const [showShareModal, setShowShareModal] = useState(false);
  const [onlineCount, setOnlineCount] = useState(0);
  const [isOnline, setIsOnline] = useState(false);
  const [publicUrl, setPublicUrl] = useState('');

  const resetGameRef = useRef<(isRemote?: boolean) => void>(() => {});

  // Fetch public URL from server
  useEffect(() => {
    fetch('/api/config')
      .then(res => res.json())
      .then(data => {
        if (data.publicUrl) {
          setPublicUrl(data.publicUrl);
        }
      })
      .catch(err => console.error('Failed to fetch config:', err));
  }, []);

  // URL-based room joining
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const roomFromUrl = params.get('room');
    if (roomFromUrl) {
      setIsMultiplayer(true);
      setInputRoomId(roomFromUrl);
      // The socket useEffect will handle the rest once isMultiplayer is true
    }
  }, []);

  // Check if a move is valid based on the board's diagonal rules
  
  const getValidMoves = useCallback((pos: Position, board: BoardState, turn: Player, goatsToPlace: number) => {
    const moves: Position[] = [];
    const piece = board[pos.y][pos.x];

    if (piece !== turn) return [];

    // Goats can only move if all are placed
    if (piece === 'GOAT' && goatsToPlace > 0) return [];

    // Check all possible adjacent spots
    for (let y = 0; y < BOARD_SIZE; y++) {
      for (let x = 0; x < BOARD_SIZE; x++) {
        const target = { x, y };
        if (board[y][x] === null && isAdjacent(pos, target)) {
          moves.push(target);
        }
      }
    }

    // Tigers can also jump to capture
    if (piece === 'TIGER') {
      const directions = [
        { dx: 1, dy: 0 }, { dx: -1, dy: 0 }, { dx: 0, dy: 1 }, { dx: 0, dy: -1 },
        { dx: 1, dy: 1 }, { dx: 1, dy: -1 }, { dx: -1, dy: 1 }, { dx: -1, dy: -1 }
      ];

      directions.forEach(({ dx, dy }) => {
        // Diagonal jumps only from even (x+y) positions
        if (Math.abs(dx) === 1 && Math.abs(dy) === 1 && (pos.x + pos.y) % 2 !== 0) return;

        const midX = pos.x + dx;
        const midY = pos.y + dy;
        const endX = pos.x + 2 * dx;
        const endY = pos.y + 2 * dy;

        if (
          endX >= 0 && endX < BOARD_SIZE &&
          endY >= 0 && endY < BOARD_SIZE &&
          board[midY][midX] === 'GOAT' &&
          board[endY][endX] === null
        ) {
          moves.push({ x: endX, y: endY });
        }
      });
    }

    return moves;
  }, []);

  const checkWinner = useCallback((board: BoardState, goatsCaptured: number, turn: Player) => {
    if (goatsCaptured >= GOATS_TO_WIN) return 'TIGER';

    // Check if tigers are trapped
    let canTigerMove = false;
    for (let y = 0; y < BOARD_SIZE; y++) {
      for (let x = 0; x < BOARD_SIZE; x++) {
        if (board[y][x] === 'TIGER') {
          if (getValidMoves({ x, y }, board, 'TIGER', 0).length > 0) {
            canTigerMove = true;
            break;
          }
        }
      }
      if (canTigerMove) break;
    }

    if (!canTigerMove) return 'GOAT';
    return null;
  }, [getValidMoves]);

  const resetGame = useCallback((isRemote = false) => {
    setGame({
      board: INITIAL_BOARD.map(row => [...row]),
      turn: 'GOAT',
      goatsToPlace: TOTAL_GOATS,
      goatsCaptured: 0,
      winner: null,
      selectedPiece: null,
      validMoves: [],
    });
    setIsAILoading(false);
    aiThinkingRef.current = false;
    
    if (isMultiplayer && socket && roomId && !isRemote) {
      socket.emit('reset', roomId);
    }
  }, [isMultiplayer, socket, roomId]);

  useEffect(() => {
    resetGameRef.current = resetGame;
  }, [resetGame]);

  const validateMove = useCallback((move: Move, currentState: GameState): boolean => {
    const { from, to, type } = move;
    const { board, turn, goatsToPlace } = currentState;

    // Basic bounds check
    if (to.x < 0 || to.x >= BOARD_SIZE || to.y < 0 || to.y >= BOARD_SIZE) return false;
    if (from && (from.x < 0 || from.x >= BOARD_SIZE || from.y < 0 || from.y >= BOARD_SIZE)) return false;

    if (type === 'PLACE') {
      if (turn !== 'GOAT' || goatsToPlace <= 0) return false;
      if (board[to.y][to.x] !== null) return false;
      return true;
    }

    if (!from) return false;
    const piece = board[from.y][from.x];
    if (piece !== turn) return false;

    // Movement validation
    const validMoves = getValidMoves(from, board, turn, goatsToPlace);
    return validMoves.some(m => m.x === to.x && m.y === to.y);
  }, [getValidMoves]);

  const applyMove = useCallback((move: Move, isRemote = false) => {
    if (!validateMove(move, game)) {
      if (!isRemote) {
        toast.error("Invalid move attempted", {
          icon: <AlertCircle className="text-red-500" />,
          description: "The requested move does not follow the rules of Bagh-Chal."
        });
      }
      return;
    }

    const { from, to, type } = move;
    const { x, y } = to;

    const newBoard = game.board.map(row => [...row]);
    let newGoatsCaptured = game.goatsCaptured;
    let newGoatsToPlace = game.goatsToPlace;
    let isCapture = false;

    if (type === 'PLACE') {
      newBoard[y][x] = 'GOAT';
      newGoatsToPlace -= 1;
      if (!isMuted) soundService.playPlace();
    } else if (from) {
      const { x: fx, y: fy } = from;
      const dx = Math.abs(x - fx);
      const dy = Math.abs(y - fy);

      // Capture logic
      if (game.turn === 'TIGER' && (dx === 2 || dy === 2)) {
        const midX = (fx + x) / 2;
        const midY = (fy + y) / 2;
        newBoard[midY][midX] = null;
        newGoatsCaptured += 1;
        isCapture = true;
        
        // Trigger capture animation
        setCapturedGoat({ x: midX, y: midY, id: Date.now() });
        setTimeout(() => setCapturedGoat(null), 1000);
      }

      newBoard[y][x] = game.turn;
      newBoard[fy][fx] = null;
      
      if (!isMuted) {
        if (isCapture) soundService.playCapture();
        else soundService.playMove();
      }
    }

    const nextTurn = game.turn === 'GOAT' ? 'TIGER' : 'GOAT';
    const winner = checkWinner(newBoard, newGoatsCaptured, nextTurn);
    
    if (winner && !isMuted) soundService.playWin();

    const newGameState = {
      ...game,
      board: newBoard,
      turn: nextTurn,
      goatsToPlace: newGoatsToPlace,
      goatsCaptured: newGoatsCaptured,
      winner,
      selectedPiece: null,
      validMoves: [],
    };

    setGame(newGameState);

    // Multiplayer sync
    if (isMultiplayer && socket && roomId && !isRemote) {
      socket.emit('move', { roomId, move, gameState: newGameState });
    }
  }, [game, checkWinner, validateMove, isMultiplayer, socket, roomId, isMuted]);

  // Multiplayer setup
  useEffect(() => {
    const newSocket = io();
    setSocket(newSocket);

    newSocket.on('connect', () => {
      setIsOnline(true);
    });

    newSocket.on('disconnect', () => {
      setIsOnline(false);
    });

    newSocket.on('online-count', (count) => {
      setOnlineCount(count);
    });

    newSocket.on('room-joined', ({ role, gameState }) => {
      setPlayerRole(role);
      if (gameState) setGame(gameState);
      toast.success(`Joined as ${role}`);
    });

    newSocket.on('move-made', ({ move, gameState }) => {
      setGame(gameState);
    });

    newSocket.on('player-joined', ({ role }) => {
      toast.info(`A ${role} has joined the room`);
    });

    newSocket.on('player-left', () => {
      toast.warning("Opponent disconnected");
    });

    newSocket.on('game-reset', () => {
      resetGameRef.current(true);
    });

    return () => {
      newSocket.disconnect();
    };
  }, []); // Run once on mount

  const joinRoom = useCallback((id: string) => {
    if (socket) {
      socket.emit('join-room', id);
      setRoomId(id);
      setShowJoinModal(false);
      // Update URL without reloading
      const url = new URL(window.location.href);
      url.searchParams.set('room', id);
      window.history.pushState({}, '', url);
    }
  }, [socket]);

  const createRoom = () => {
    setIsMultiplayer(true);
  };

  useEffect(() => {
    if (isMultiplayer && socket && !roomId) {
      // If we have an inputRoomId from URL or modal, join it
      if (inputRoomId) {
        joinRoom(inputRoomId);
      } else {
        // Otherwise create a new one
        const id = Math.random().toString(36).substring(2, 8).toUpperCase();
        joinRoom(id);
      }
    }
  }, [isMultiplayer, socket, roomId, joinRoom, inputRoomId]);

  useEffect(() => {
    if (game.winner || aiPlayer === 'NONE' || game.turn !== aiPlayer || aiThinkingRef.current || isMultiplayer) return;

    const triggerAI = async () => {
      aiThinkingRef.current = true;
      setIsAILoading(true);
      
      // Small delay to allow for UI feedback and deep analysis
      await new Promise(resolve => setTimeout(resolve, 800));
      
      const move = await getAIMove(game.board, game.turn, game.goatsToPlace, game.goatsCaptured, difficulty);
      
      if (move) {
        if (validateMove(move, game)) {
          applyMove(move);
        } else {
          console.warn("AI returned invalid move, attempting fallback...");
          const allValidMoves: Move[] = [];
          if (game.turn === 'GOAT' && game.goatsToPlace > 0) {
            for (let y = 0; y < BOARD_SIZE; y++) {
              for (let x = 0; x < BOARD_SIZE; x++) {
                if (game.board[y][x] === null) {
                  allValidMoves.push({ to: { x, y }, type: 'PLACE' });
                }
              }
            }
          } else {
            for (let y = 0; y < BOARD_SIZE; y++) {
              for (let x = 0; x < BOARD_SIZE; x++) {
                if (game.board[y][x] === game.turn) {
                  const moves = getValidMoves({ x, y }, game.board, game.turn, game.goatsToPlace);
                  moves.forEach(m => allValidMoves.push({ from: { x, y }, to: m, type: 'MOVE' }));
                }
              }
            }
          }
          
          if (allValidMoves.length > 0) {
            const randomMove = allValidMoves[Math.floor(Math.random() * allValidMoves.length)];
            applyMove(randomMove);
          }
        }
      }
      
      setIsAILoading(false);
      aiThinkingRef.current = false;
    };

    triggerAI();
  }, [game, aiPlayer, applyMove, getValidMoves, validateMove, isMultiplayer, difficulty]);

  const handleCellClick = (x: number, y: number) => {
    if (game.winner) return;

    // Multiplayer turn check
    if (isMultiplayer && playerRole && game.turn !== playerRole) {
      toast.warning(`It's not your turn! You are playing as ${playerRole}`);
      return;
    }

    const piece = game.board[y][x];

    // Placement Phase for Goats
    if (game.turn === 'GOAT' && game.goatsToPlace > 0) {
      if (piece === null) {
        applyMove({ to: { x, y }, type: 'PLACE' });
      }
      return;
    }

    // Selection Phase
    if (piece === game.turn) {
      const moves = getValidMoves({ x, y }, game.board, game.turn, game.goatsToPlace);
      setGame(prev => ({
        ...prev,
        selectedPiece: { x, y },
        validMoves: moves,
      }));
      return;
    }

    // Movement/Capture Phase
    if (game.selectedPiece) {
      const move: Move = {
        from: game.selectedPiece,
        to: { x, y },
        type: 'MOVE' // applyMove handles capture logic internally
      };
      
      if (game.validMoves.some(m => m.x === x && m.y === y)) {
        applyMove(move);
      } else {
        // Deselect if clicking elsewhere
        setGame(prev => ({
          ...prev,
          selectedPiece: null,
          validMoves: [],
        }));
      }
    }
  };

  return (
    <div className="min-h-screen bg-[#FDFCF8] text-[#2D2D2D] font-sans p-4 md:p-8 flex flex-col items-center">
      <Toaster position="top-center" expand={false} richColors />
      {/* Header */}
      <header className="w-full max-w-2xl flex justify-between items-center mb-8">
        <div className="flex items-center gap-4">
          <div className="w-12 h-12 bg-[#1A1A1A] rounded-2xl flex items-center justify-center text-white shadow-xl rotate-3">
            <Trophy size={24} />
          </div>
          <div>
            <h1 className="text-3xl font-serif italic tracking-tight text-[#1A1A1A]">Bagh-Chal</h1>
            <div className="flex items-center gap-2">
              <div className={`w-1.5 h-1.5 rounded-full ${isOnline ? 'bg-green-500 shadow-[0_0_8px_rgba(34,197,94,0.6)]' : 'bg-red-500'}`} />
              <span className="text-[9px] font-mono opacity-40 uppercase tracking-widest">
                {isOnline ? `${onlineCount} Players Online` : 'Offline'}
              </span>
            </div>
          </div>
        </div>
        <div className="flex gap-4">
          <button 
            onClick={() => setIsMuted(!isMuted)}
            className="p-2 hover:bg-[#1A1A1A] hover:text-white transition-colors rounded-full border border-[#1A1A1A]/10"
            title={isMuted ? "Unmute" : "Mute"}
          >
            {isMuted ? <VolumeX size={20} /> : <Volume2 size={20} />}
          </button>
          <button 
            onClick={() => setShowRules(!showRules)}
            className="p-2 hover:bg-[#1A1A1A] hover:text-white transition-colors rounded-full border border-[#1A1A1A]/10"
          >
            <Info size={20} />
          </button>
          <button 
            onClick={() => resetGame()}
            className="p-2 hover:bg-[#1A1A1A] hover:text-white transition-colors rounded-full border border-[#1A1A1A]/10"
          >
            <RotateCcw size={20} />
          </button>
        </div>
      </header>

      {/* AI Controls */}
      <div className="w-full max-w-2xl flex gap-2 mb-6 overflow-x-auto pb-2">
        <button 
          onClick={() => { setAiPlayer('NONE'); setIsMultiplayer(false); setRoomId(null); resetGame(); }}
          className={`flex-1 min-w-[120px] py-3 px-4 rounded-xl border transition-all flex items-center justify-center gap-2 text-xs font-bold uppercase tracking-wider
            ${aiPlayer === 'NONE' && !isMultiplayer ? 'bg-[#1A1A1A] text-white border-[#1A1A1A]' : 'bg-white text-[#1A1A1A] border-[#1A1A1A]/10 hover:bg-[#1A1A1A]/5'}
          `}
        >
          <UserCheck size={16} /> PvP
        </button>
        <button 
          onClick={() => { setAiPlayer('TIGER'); setIsMultiplayer(false); setRoomId(null); resetGame(); }}
          className={`flex-1 min-w-[120px] py-3 px-4 rounded-xl border transition-all flex items-center justify-center gap-2 text-xs font-bold uppercase tracking-wider
            ${aiPlayer === 'TIGER' ? 'bg-[#1A1A1A] text-white border-[#1A1A1A]' : 'bg-white text-[#1A1A1A] border-[#1A1A1A]/10 hover:bg-[#1A1A1A]/5'}
          `}
        >
          <Cpu size={16} /> AI Tiger
        </button>
        <button 
          onClick={() => { setAiPlayer('GOAT'); setIsMultiplayer(false); setRoomId(null); resetGame(); }}
          className={`flex-1 min-w-[120px] py-3 px-4 rounded-xl border transition-all flex items-center justify-center gap-2 text-xs font-bold uppercase tracking-wider
            ${aiPlayer === 'GOAT' ? 'bg-[#1A1A1A] text-white border-[#1A1A1A]' : 'bg-white text-[#1A1A1A] border-[#1A1A1A]/10 hover:bg-[#1A1A1A]/5'}
          `}
        >
          <Cpu size={16} /> AI Goat
        </button>
        <button 
          onClick={() => { setAiPlayer('NONE'); setIsMultiplayer(true); }}
          className={`flex-1 min-w-[120px] py-3 px-4 rounded-xl border transition-all flex items-center justify-center gap-2 text-xs font-bold uppercase tracking-wider
            ${isMultiplayer ? 'bg-[#1A1A1A] text-white border-[#1A1A1A]' : 'bg-white text-[#1A1A1A] border-[#1A1A1A]/10 hover:bg-[#1A1A1A]/5'}
          `}
        >
          <Users size={16} /> Multiplayer
        </button>
      </div>

      {/* Multiplayer Controls */}
      <AnimatePresence>
        {isMultiplayer && (
          <motion.div 
            initial={{ opacity: 0, y: -10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -10 }}
            className="w-full max-w-2xl mb-6 flex flex-col gap-4"
          >
            {!roomId ? (
              <div className="flex gap-2">
                <button 
                  onClick={createRoom}
                  className="flex-1 py-3 bg-[#1A1A1A] text-white rounded-xl font-bold text-xs uppercase tracking-widest hover:opacity-90 transition-all flex items-center justify-center gap-2"
                >
                  <Link size={16} /> Create Room
                </button>
                <button 
                  onClick={() => setShowJoinModal(true)}
                  className="flex-1 py-3 bg-white text-[#1A1A1A] border border-[#1A1A1A]/10 rounded-xl font-bold text-xs uppercase tracking-widest hover:bg-[#1A1A1A]/5 transition-all flex items-center justify-center gap-2"
                >
                  <Users size={16} /> Join Room
                </button>
              </div>
            ) : (
              <div className="bg-white border border-[#1A1A1A]/5 p-6 rounded-3xl shadow-sm flex flex-col gap-4">
                <div className="flex justify-between items-center">
                  <div className="flex flex-col">
                    <span className="text-[10px] uppercase tracking-widest opacity-40">Room ID</span>
                    <div className="flex items-center gap-2">
                      <span className="font-mono font-bold text-lg">{roomId}</span>
                      <button 
                        onClick={() => {
                          navigator.clipboard.writeText(roomId);
                          setCopied(true);
                          setTimeout(() => setCopied(false), 2000);
                          toast.success("Room ID copied!");
                        }}
                        className="p-1 hover:bg-[#1A1A1A]/5 rounded-md transition-all"
                      >
                        {copied ? <Check size={14} className="text-green-500" /> : <Copy size={14} />}
                      </button>
                    </div>
                  </div>
                  <div className="flex flex-col items-end">
                    <span className="text-[10px] uppercase tracking-widest opacity-40">Your Role</span>
                    <span className={`font-bold uppercase tracking-widest text-sm ${playerRole === 'TIGER' ? 'text-orange-500' : 'text-blue-500'}`}>
                      {playerRole || 'Waiting...'}
                    </span>
                  </div>
                </div>
                <div className="h-px bg-[#1A1A1A]/5 w-full" />
                <div className="flex gap-2">
                  <button 
                    onClick={() => setShowShareModal(true)}
                    className="flex-1 py-2 bg-[#1A1A1A]/5 hover:bg-[#1A1A1A]/10 rounded-xl transition-all flex items-center justify-center gap-2 text-[10px] font-bold uppercase tracking-widest"
                  >
                    <Share2 size={14} /> Share Game
                  </button>
                </div>
                <p className="text-[10px] text-center opacity-40 uppercase tracking-[0.2em]">
                  Share this ID with a friend to play together
                </p>
              </div>
            )}
          </motion.div>
        )}
      </AnimatePresence>

      {/* Difficulty Controls */}
      {aiPlayer !== 'NONE' && (
        <div className="w-full max-w-2xl flex flex-col gap-3 mb-8">
          <div className="flex justify-between items-center px-1">
            <span className="text-[10px] uppercase tracking-[0.2em] font-bold opacity-40">AI Intelligence</span>
            <span className={`text-[10px] font-mono font-bold px-2 py-0.5 rounded-full border
              ${difficulty === 'HARD' ? 'text-red-500 border-red-500/20 bg-red-500/5' : 
                difficulty === 'MEDIUM' ? 'text-blue-500 border-blue-500/20 bg-blue-500/5' : 
                'text-green-500 border-green-500/20 bg-green-500/5'}
            `}>
              {difficulty === 'HARD' ? 'Grandmaster' : difficulty === 'MEDIUM' ? 'Intermediate' : 'Beginner'}
            </span>
          </div>
          <div className="flex gap-2">
            {(['EASY', 'MEDIUM', 'HARD'] as Difficulty[]).map((level) => (
              <button
                key={level}
                onClick={() => { setDifficulty(level); }}
                className={`flex-1 py-3 px-4 rounded-xl border text-[10px] font-bold uppercase tracking-widest transition-all
                  ${difficulty === level ? 'bg-[#1A1A1A] text-white border-[#1A1A1A] shadow-lg scale-[1.02]' : 'bg-white text-[#1A1A1A] border-[#1A1A1A]/10 hover:bg-[#1A1A1A]/5'}
                `}
              >
                {level}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Game Stats */}
      <div className="w-full max-w-2xl grid grid-cols-3 gap-4 mb-8">
        <div className="bg-white border border-[#1A1A1A]/5 p-4 rounded-2xl shadow-sm flex flex-col items-center">
          <span className="text-[10px] uppercase tracking-wider opacity-40 mb-1">Turn</span>
          <div className="flex items-center gap-2">
            {game.turn === 'GOAT' ? <span className="text-2xl">🐐</span> : <span className="text-2xl">🐯</span>}
            <span className="font-medium text-sm">{game.turn}</span>
          </div>
        </div>
        <div className="bg-white border border-[#1A1A1A]/5 p-4 rounded-2xl shadow-sm flex flex-col items-center">
          <span className="text-[10px] uppercase tracking-wider opacity-40 mb-1">To Place</span>
          <span className="text-xl font-mono font-bold">{game.goatsToPlace}</span>
        </div>
        <div 
          ref={scoreRef}
          className="bg-white border border-[#1A1A1A]/5 p-4 rounded-2xl shadow-sm flex flex-col items-center"
        >
          <span className="text-[10px] uppercase tracking-wider opacity-40 mb-1">Captured</span>
          <span className="text-xl font-mono font-bold text-red-500">{game.goatsCaptured}/5</span>
        </div>
      </div>

      {/* Board Container */}
      <div className="w-full flex flex-col items-center justify-center relative">
        {/* Board */}
        <div 
          ref={boardRef}
          className="relative aspect-square w-full max-w-[500px] bg-white border border-[#1A1A1A]/10 p-6 md:p-10 rounded-3xl shadow-xl flex-shrink-0"
        >
          {/* AI Thinking Indicator */}
          <AnimatePresence>
            {isAILoading && (
              <motion.div 
                initial={{ opacity: 0, y: -20 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -20 }}
                className="absolute -top-20 left-0 right-0 flex flex-col items-center gap-3 z-[60]"
              >
                <div className="bg-[#1A1A1A] text-white px-6 py-3 rounded-2xl flex items-center gap-3 text-xs font-mono uppercase tracking-[0.2em] shadow-2xl border border-white/10">
                  <div className="relative">
                    <Brain size={18} className="text-blue-400" />
                    <motion.div 
                      animate={{ scale: [1, 1.8, 1], opacity: [0.5, 0, 0.5] }}
                      transition={{ duration: 2, repeat: Infinity }}
                      className="absolute inset-0 bg-blue-400 rounded-full -z-10"
                    />
                  </div>
                  <span className="flex items-center">
                    AI Analyzing
                    <motion.span
                      animate={{ opacity: [0, 1, 0] }}
                      transition={{ duration: 1.5, repeat: Infinity, times: [0, 0.5, 1] }}
                    >.</motion.span>
                    <motion.span
                      animate={{ opacity: [0, 1, 0] }}
                      transition={{ duration: 1.5, repeat: Infinity, times: [0, 0.5, 1], delay: 0.2 }}
                    >.</motion.span>
                    <motion.span
                      animate={{ opacity: [0, 1, 0] }}
                      transition={{ duration: 1.5, repeat: Infinity, times: [0, 0.5, 1], delay: 0.4 }}
                    >.</motion.span>
                  </span>
                  <Sparkles size={14} className="text-yellow-400 animate-pulse" />
                </div>
                
                {/* Scanning Progress Bar */}
                <div className="w-48 h-1 bg-[#1A1A1A]/10 rounded-full overflow-hidden backdrop-blur-sm">
                  <motion.div 
                    initial={{ x: "-100%" }}
                    animate={{ x: "100%" }}
                    transition={{ duration: 1.2, repeat: Infinity, ease: "easeInOut" }}
                    className="w-1/2 h-full bg-gradient-to-r from-transparent via-blue-400 to-transparent shadow-[0_0_15px_rgba(96,165,250,0.8)]"
                  />
                </div>
              </motion.div>
            )}
          </AnimatePresence>
          {/* Grid Lines */}
          <svg className="absolute inset-0 w-full h-full pointer-events-none p-6 md:p-10" viewBox="0 0 400 400">
            <g stroke="#1A1A1A" strokeWidth="2" opacity="0.8">
              {/* Horizontal & Vertical */}
              {[0, 1, 2, 3, 4].map(i => (
                <React.Fragment key={i}>
                  <line x1={i * 100} y1="0" x2={i * 100} y2="400" />
                  <line x1="0" y1={i * 100} x2="400" y2={i * 100} />
                </React.Fragment>
              ))}
              {/* Diagonals */}
              <line x1="0" y1="0" x2="400" y2="400" />
              <line x1="0" y1="400" x2="400" y2="0" />
              
              {/* Inner Diagonals */}
              <line x1="200" y1="0" x2="0" y2="200" />
              <line x1="200" y1="0" x2="400" y2="200" />
              <line x1="200" y1="400" x2="0" y2="200" />
              <line x1="200" y1="400" x2="400" y2="200" />
            </g>
          </svg>

          {/* Board Cells (Intersections) */}
          <div className="absolute inset-0 p-6 md:p-10 z-10">
            <div className="relative w-full h-full">
              {/* Flying Goat Animation Overlay */}
              <AnimatePresence>
                {capturedGoat && (
                  <motion.div
                    key={capturedGoat.id}
                    initial={{ 
                      left: (capturedGoat.x * 25) + "%", 
                      top: (capturedGoat.y * 25) + "%",
                      scale: 1,
                      opacity: 1,
                      rotate: 0,
                    }}
                    animate={{ 
                      left: "100%", // Move towards the stats area
                      top: "-150px", // Move up
                      scale: 0.2,
                      opacity: 0,
                      rotate: 720
                    }}
                    transition={{ 
                      duration: 1, 
                      ease: [0.34, 1.56, 0.64, 1] 
                    }}
                    className="absolute text-5xl z-[100] pointer-events-none select-none -translate-x-1/2 -translate-y-1/2"
                  >
                    🐐
                  </motion.div>
                )}
              </AnimatePresence>

              {game.board.map((row, y) => 
                row.map((cell, x) => {
                  const isSelected = game.selectedPiece?.x === x && game.selectedPiece?.y === y;
                  const isValidMove = game.validMoves.some(m => m.x === x && m.y === y);
                  
                  return (
                    <div 
                      key={`${x}-${y}`}
                      onClick={() => handleCellClick(x, y)}
                      style={{ 
                        left: `${x * 25}%`, 
                        top: `${y * 25}%`,
                      }}
                      className="absolute w-12 h-12 -translate-x-1/2 -translate-y-1/2 flex items-center justify-center cursor-pointer group"
                    >
                      {/* Intersection Point (Visual dot) */}
                      <div className={`w-2 h-2 rounded-full bg-[#1A1A1A] transition-all duration-300 
                        ${cell ? 'scale-0 opacity-0' : 'opacity-20 group-hover:opacity-40 group-hover:scale-150'}
                      `} />
                      
                      {/* Valid Move Indicator */}
                      {isValidMove && (
                        <motion.div 
                          initial={{ scale: 0 }}
                          animate={{ scale: 1 }}
                          className="absolute w-10 h-10 rounded-full border-2 border-dashed border-[#1A1A1A]/30 bg-[#1A1A1A]/5"
                        />
                      )}

                      {/* Piece */}
                      <AnimatePresence mode="popLayout">
                        {cell && (
                          <motion.div
                            key={`${cell}-${x}-${y}`}
                            initial={{ scale: 0, rotate: -45 }}
                            animate={{ 
                              scale: 1, 
                              rotate: 0,
                              y: isSelected ? -12 : 0
                            }}
                            exit={{ scale: 0, opacity: 0 }}
                            className={`absolute text-4xl md:text-5xl select-none z-20 drop-shadow-md transition-all
                              ${isSelected ? 'drop-shadow-2xl' : ''}
                            `}
                          >
                            {cell === 'TIGER' ? '🐯' : '🐐'}
                          </motion.div>
                        )}
                      </AnimatePresence>
                    </div>
                  );
                })
              )}
            </div>
          </div>

          {/* Winner Overlay */}
          <AnimatePresence>
            {game.winner && (
              <motion.div 
                initial={{ opacity: 0, backdropFilter: 'blur(0px)' }}
                animate={{ opacity: 1, backdropFilter: 'blur(8px)' }}
                className="absolute inset-0 z-50 flex flex-col items-center justify-center bg-white/60 rounded-3xl"
              >
                <motion.div 
                  initial={{ y: 20, opacity: 0 }}
                  animate={{ y: 0, opacity: 1 }}
                  className="bg-[#1A1A1A] text-white p-8 rounded-3xl shadow-2xl flex flex-col items-center text-center max-w-[80%]"
                >
                  <Trophy className="text-yellow-400 mb-4" size={48} />
                  <h2 className="text-2xl font-serif italic mb-2">Victory!</h2>
                  <p className="text-sm opacity-70 mb-6 uppercase tracking-widest">
                    The {game.winner}s have won the hunt
                  </p>
                  <button 
                    onClick={resetGame}
                    className="w-full py-3 bg-white text-[#1A1A1A] rounded-xl font-bold hover:bg-opacity-90 transition-all flex items-center justify-center gap-2"
                  >
                    <RotateCcw size={18} />
                    Play Again
                  </button>
                </motion.div>
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </div>

      {/* Join Room Modal */}
      <AnimatePresence>
        {showJoinModal && (
          <motion.div 
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-[110] flex items-center justify-center bg-black/40 backdrop-blur-sm p-4"
            onClick={() => setShowJoinModal(false)}
          >
            <motion.div 
              initial={{ scale: 0.9, y: 20 }}
              animate={{ scale: 1, y: 0 }}
              className="bg-white w-full max-w-sm p-8 rounded-3xl shadow-2xl"
              onClick={e => e.stopPropagation()}
            >
              <h2 className="text-2xl font-serif italic mb-6">Join Room</h2>
              <div className="space-y-4">
                <div className="flex flex-col gap-2">
                  <label className="text-[10px] uppercase tracking-widest opacity-40 px-1">Enter Room ID</label>
                  <input 
                    type="text"
                    value={inputRoomId}
                    onChange={e => setInputRoomId(e.target.value.toUpperCase())}
                    placeholder="E.G. AB12CD"
                    className="w-full p-4 bg-[#FDFCF8] border border-[#1A1A1A]/10 rounded-xl font-mono text-lg focus:outline-none focus:border-[#1A1A1A] transition-all"
                  />
                </div>
                <button 
                  onClick={() => {
                    if (inputRoomId.length > 0) {
                      setIsMultiplayer(true);
                      // Socket will be created, we need to join after it's ready
                      // But we can just set the roomId and let useEffect handle it
                      // Actually, let's just wait for socket
                    }
                  }}
                  className="w-full py-4 bg-[#1A1A1A] text-white rounded-xl font-bold text-xs uppercase tracking-widest hover:opacity-90 transition-all"
                >
                  Join Game
                </button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Share Modal */}
      <AnimatePresence>
        {showShareModal && roomId && (
          <motion.div 
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-[120] flex items-center justify-center bg-black/60 backdrop-blur-md p-4"
            onClick={() => setShowShareModal(false)}
          >
            <motion.div 
              initial={{ scale: 0.9, y: 20 }}
              animate={{ scale: 1, y: 0 }}
              className="bg-white w-full max-w-md p-8 rounded-[40px] shadow-2xl relative overflow-hidden"
              onClick={e => e.stopPropagation()}
            >
              <button 
                onClick={() => setShowShareModal(false)}
                className="absolute top-6 right-6 p-2 hover:bg-[#1A1A1A]/5 rounded-full transition-all"
              >
                <X size={20} />
              </button>

              <div className="flex flex-col items-center text-center gap-6">
                <div className="w-16 h-16 bg-[#1A1A1A] rounded-3xl flex items-center justify-center text-white shadow-xl rotate-3">
                  <Share2 size={32} />
                </div>
                
                <div>
                  <h2 className="text-3xl font-serif italic mb-2">Share Game</h2>
                  <p className="text-sm opacity-60">Invite a friend to join your Bagh-Chal match</p>
                </div>

                <div className="p-6 bg-white border-2 border-[#1A1A1A]/5 rounded-[32px] shadow-inner">
                  <QRCodeSVG 
                    value={(() => {
                      const baseUrl = publicUrl || window.location.origin;
                      let origin = baseUrl;
                      // AI Studio: Automatically switch to the shared (pre) URL for sharing if not already using it
                      if (origin.includes('-dev-')) {
                        origin = origin.replace('-dev-', '-pre-');
                      }
                      return `${origin}${window.location.pathname}?room=${roomId}`;
                    })()}
                    size={200}
                    level="H"
                    includeMargin={true}
                    imageSettings={{
                      src: "https://picsum.photos/seed/tiger/40/40",
                      x: undefined,
                      y: undefined,
                      height: 40,
                      width: 40,
                      excavate: true,
                    }}
                  />
                </div>

                <div className="w-full space-y-3">
                  <div className="flex flex-col gap-1.5 items-start">
                    <span className="text-[10px] uppercase tracking-widest opacity-40 px-1">Game Link</span>
                    <div className="w-full flex gap-2 p-2 bg-[#FDFCF8] border border-[#1A1A1A]/10 rounded-2xl">
                      <input 
                        readOnly
                        value={(() => {
                          const baseUrl = publicUrl || window.location.origin;
                          let origin = baseUrl;
                          if (origin.includes('-dev-')) {
                            origin = origin.replace('-dev-', '-pre-');
                          }
                          return `${origin}${window.location.pathname}?room=${roomId}`;
                        })()}
                        className="flex-1 bg-transparent px-2 text-xs font-mono truncate focus:outline-none"
                      />
                      <button 
                        onClick={() => {
                          const baseUrl = publicUrl || window.location.origin;
                          let origin = baseUrl;
                          if (origin.includes('-dev-')) {
                            origin = origin.replace('-dev-', '-pre-');
                          }
                          const url = `${origin}${window.location.pathname}?room=${roomId}`;
                          navigator.clipboard.writeText(url);
                          setCopied(true);
                          setTimeout(() => setCopied(false), 2000);
                          toast.success("Link copied!");
                        }}
                        className="px-4 py-2 bg-[#1A1A1A] text-white rounded-xl text-[10px] font-bold uppercase tracking-widest hover:opacity-90 transition-all flex items-center gap-2"
                      >
                        {copied ? <Check size={14} /> : <Copy size={14} />}
                        {copied ? "Copied" : "Copy"}
                      </button>
                    </div>
                  </div>
                </div>

                <p className="text-[10px] opacity-40 uppercase tracking-[0.2em] max-w-[200px]">
                  Scan the QR code or copy the link to invite your opponent
                </p>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Rules Modal */}
      <AnimatePresence>
        {showRules && (
          <motion.div 
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-[100] flex items-center justify-center bg-black/40 backdrop-blur-sm p-4"
            onClick={() => setShowRules(false)}
          >
            <motion.div 
              initial={{ scale: 0.9, y: 20 }}
              animate={{ scale: 1, y: 0 }}
              className="bg-white w-full max-w-lg p-8 rounded-3xl shadow-2xl overflow-y-auto max-h-[80vh]"
              onClick={e => e.stopPropagation()}
            >
              <div className="flex justify-between items-start mb-6">
                <h2 className="text-2xl font-serif italic">How to Play</h2>
                <button onClick={() => setShowRules(false)} className="opacity-40 hover:opacity-100">✕</button>
              </div>
              
              <div className="space-y-6 text-sm leading-relaxed text-[#4A4A4A]">
                <section>
                  <h3 className="font-bold text-[#1A1A1A] mb-2 flex items-center gap-2">
                    <User size={16} /> The Objective
                  </h3>
                  <p><strong>Tigers:</strong> Capture 5 goats by jumping over them to an empty spot.</p>
                  <p><strong>Goats:</strong> Trap all 4 tigers so they have no legal moves left.</p>
                </section>

                <section>
                  <h3 className="font-bold text-[#1A1A1A] mb-2 flex items-center gap-2">
                    <ShieldAlert size={16} /> Movement
                  </h3>
                  <ul className="list-disc pl-4 space-y-1">
                    <li>Pieces move along the lines to adjacent empty intersections.</li>
                    <li>Goats must all be placed (20 total) before they can move.</li>
                    <li>Tigers can move or capture during the placement phase.</li>
                    <li>Diagonal moves are only allowed at specific intersections (marked with diagonal lines).</li>
                  </ul>
                </section>

                <section className="bg-[#FDFCF8] p-4 rounded-2xl border border-[#1A1A1A]/5">
                  <p className="italic font-serif">"Bagh-Chal is a game of patience and strategy. While the tigers are powerful, the goats have the strength of numbers."</p>
                </section>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Footer */}
      <footer className="mt-12 text-[10px] uppercase tracking-[0.2em] opacity-30 font-mono text-center">
        Traditional Strategy Game • Nepal
      </footer>
    </div>
  );
}
