import { useState, useEffect, useCallback, useRef } from "react";

// ─── TILE VALUES ────────────────────────────────────────────────
const TV = {A:1,B:3,C:3,D:2,E:1,F:4,G:2,H:4,I:1,J:8,K:5,L:1,M:3,N:1,O:1,P:3,Q:10,R:1,S:1,T:1,U:1,V:4,W:4,X:8,Y:4,Z:10};

// ─── OFFICIAL SCRABBLE BOARD PREMIUM SQUARES (0-indexed) ────────
const BOARD_TEMPLATE = (() => {
  const b = Array(15).fill(null).map(() => Array(15).fill('.'));
  [[0,0],[0,7],[0,14],[7,0],[7,14],[14,0],[14,7],[14,14]].forEach(([r,c]) => { b[r][c]='TW'; });
  [[1,1],[2,2],[3,3],[4,4],[1,13],[2,12],[3,11],[4,10],
   [13,1],[12,2],[11,3],[10,4],[13,13],[12,12],[11,11],[10,10],[7,7]].forEach(([r,c]) => { b[r][c]='DW'; });
  [[1,5],[1,9],[5,1],[5,5],[5,9],[5,13],[9,1],[9,5],[9,9],[9,13],[13,5],[13,9]].forEach(([r,c]) => { b[r][c]='TL'; });
  [[0,3],[0,11],[2,6],[2,8],[3,0],[3,7],[3,14],[6,2],[6,6],[6,8],[6,12],
   [7,3],[7,11],[8,2],[8,6],[8,8],[8,12],[11,0],[11,7],[11,14],[12,6],[12,8],[14,3],[14,11]].forEach(([r,c]) => { b[r][c]='DL'; });
  return b;
})();

// ─── REACT APP ──────────────────────────────────────────────────
export default function ScrabbleTrainer() {
  // Dictionary state
  const [WORD_SET, setWordSet] = useState(new Set());
  const [WORD_LIST, setWordList] = useState([]);
  const [isLoadingDict, setIsLoadingDict] = useState(true);
  
  // Game state
  const [scenario, setScenario] = useState(null);
  const [placed, setPlaced] = useState({});
  const [selRack, setSelRack] = useState(null);
  const [round, setRound] = useState('offense');
  const [offResult, setOffResult] = useState(null);
  const [defResult, setDefResult] = useState(null);
  const [error, setError] = useState(null);
  const [stats, setStats] = useState({ played: 0, offOk: 0, defOk: 0 });
  const [loading, setLoading] = useState(true);
  const [drag, setDrag] = useState(null);
  const [rackOrder, setRackOrder] = useState([0,1,2,3,4,5,6]); // Track rack arrangement
  const boardRef = useRef(null);
  const rackRef = useRef(null);

  // Load TWL06 dictionary on mount
  useEffect(() => {
    fetch('/TWL06.txt')
      .then(response => response.text())
      .then(text => {
        const words = text.split('\n')
          .map(w => w.trim().toUpperCase())
          .filter(w => w.length >= 2 && w.length <= 15 && /^[A-Z]+$/.test(w));
        
        // Add any post-2006 words commonly accepted
        const additions = ['EMOJI', 'EMOJIS', 'SELFIE', 'SELFIES', 'HASHTAG', 'HASHTAGS'];
        additions.forEach(w => words.push(w));
        
        const wordSet = new Set(words);
        const wordList = [...wordSet].sort((a, b) => a.length - b.length || a.localeCompare(b));
        
        setWordSet(wordSet);
        setWordList(wordList);
        setIsLoadingDict(false);
      })
      .catch(error => {
        console.error('Failed to load dictionary:', error);
        setIsLoadingDict(false);
      });
  }, []);

  // ─── BOARD GENERATION ───────────────────────────────────────────
  const buildConnectedBoard = useCallback(() => {
    if (WORD_LIST.length === 0) return null;
    
    const board = Array(15).fill(null).map(() => Array(15).fill(null));
    const premiumsUsed = {};
    const pool = WORD_LIST.filter(w => w.length >= 3 && w.length <= 6);

    function getLetterAt(r, c) { return board[r] && board[r][c]; }

    function canPlaceWord(word, row, col, horizontal) {
      const len = word.length;
      if (horizontal) { if (col + len > 15) return false; }
      else { if (row + len > 15) return false; }

      for (let i = 0; i < len; i++) {
        const r = horizontal ? row : row + i;
        const c = horizontal ? col + i : col;
        const existing = getLetterAt(r, c);
        if (existing !== null && existing !== word[i]) return false;
      }

      if (horizontal) {
        if (col > 0 && getLetterAt(row, col - 1) !== null) return false;
        if (col + len < 15 && getLetterAt(row, col + len) !== null) return false;
      } else {
        if (row > 0 && getLetterAt(row - 1, col) !== null) return false;
        if (row + len < 15 && getLetterAt(row + len, col) !== null) return false;
      }

      for (let i = 0; i < len; i++) {
        const r = horizontal ? row : row + i;
        const c = horizontal ? col + i : col;
        if (getLetterAt(r, c) !== null) continue;

        if (horizontal) {
          const above = getLetterAt(r - 1, c);
          const below = getLetterAt(r + 1, c);
          if (above !== null || below !== null) {
            let cw = '';
            let cr = r;
            while (cr > 0 && getLetterAt(cr - 1, c) !== null) cr--;
            while (cr < 15) {
              const ch = (cr === r) ? word[i] : getLetterAt(cr, c);
              if (ch === null) break;
              cw += ch;
              cr++;
            }
            if (cw.length > 1 && !WORD_SET.has(cw)) return false;
          }
        } else {
          const left = getLetterAt(r, c - 1);
          const right = getLetterAt(r, c + 1);
          if (left !== null || right !== null) {
            let cw = '';
            let cc = c;
            while (cc > 0 && getLetterAt(r, cc - 1) !== null) cc--;
            while (cc < 15) {
              const ch = (cc === c) ? word[i] : getLetterAt(r, cc);
              if (ch === null) break;
              cw += ch;
              cc++;
            }
            if (cw.length > 1 && !WORD_SET.has(cw)) return false;
          }
        }
      }
      return true;
    }

    function placeWord(word, row, col, horizontal) {
      if (!WORD_SET.has(word)) {
        console.warn(`Skipping invalid word: ${word}`);
        return false;
      }
      for (let i = 0; i < word.length; i++) {
        const r = horizontal ? row : row + i;
        const c = horizontal ? col + i : col;
        board[r][c] = word[i];
        premiumsUsed[`${r},${c}`] = true;
      }
      return true;
    }

    function sharesLetter(word, row, col, horizontal) {
      for (let i = 0; i < word.length; i++) {
        const r = horizontal ? row : row + i;
        const c = horizontal ? col + i : col;
        if (getLetterAt(r, c) !== null) return true;
      }
      return false;
    }

    function shuffle(arr) {
      const a = [...arr];
      for (let i = a.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [a[i], a[j]] = [a[j], a[i]];
      }
      return a;
    }

    const firstWords = shuffle(pool.filter(w => w.length >= 3 && w.length <= 5));
    let placed = false;
    for (const w of firstWords) {
      const col = 7 - Math.floor(w.length / 2);
      if (col >= 0 && col + w.length <= 15) {
        if (placeWord(w, 7, col, true)) {
          placed = true;
          break;
        }
      }
    }
    if (!placed) return null;

    let attempts = 0;
    while (attempts < 200) {
      attempts++;
      const word = pool[Math.floor(Math.random() * pool.length)];
      const tiles = [];
      for (let r = 0; r < 15; r++)
        for (let c = 0; c < 15; c++)
          if (board[r][c] !== null) tiles.push({ r, c, letter: board[r][c] });

      if (tiles.length === 0) break;
      const anchor = tiles[Math.floor(Math.random() * tiles.length)];
      const matchPositions = [];
      for (let i = 0; i < word.length; i++) {
        if (word[i] === anchor.letter) matchPositions.push(i);
      }
      if (matchPositions.length === 0) continue;

      const matchIdx = matchPositions[Math.floor(Math.random() * matchPositions.length)];
      const horizontal = Math.random() < 0.5;
      let row, col;
      if (horizontal) {
        row = anchor.r;
        col = anchor.c - matchIdx;
      } else {
        row = anchor.r - matchIdx;
        col = anchor.c;
      }

      if (row < 0 || col < 0) continue;
      if (horizontal && col + word.length > 15) continue;
      if (!horizontal && row + word.length > 15) continue;

      if (canPlaceWord(word, row, col, horizontal) && sharesLetter(word, row, col, horizontal)) {
        placeWord(word, row, col, horizontal);
        const tileCount = tiles.length + word.length - matchPositions.filter(i => {
          const r = horizontal ? row : row + i;
          const c = horizontal ? col + i : col;
          return getLetterAt(r, c) !== null;
        }).length;
        if (tileCount >= 18 && Math.random() < 0.4) break;
        if (tileCount >= 40) break;
      }
    }

    // Final validation: check all words on board are valid
    const allWordsValid = [];
    // Check horizontal words
    for (let r = 0; r < 15; r++) {
      let c = 0;
      while (c < 15) {
        if (board[r][c] === null) { c++; continue; }
        let start = c;
        let word = '';
        while (c < 15 && board[r][c] !== null) {
          word += board[r][c];
          c++;
        }
        if (word.length >= 2) {
          if (!WORD_SET.has(word)) {
            console.error(`Invalid horizontal word on board: ${word}`);
            return null; // Reject this board
          }
          allWordsValid.push(word);
        }
      }
    }
    // Check vertical words
    for (let c = 0; c < 15; c++) {
      let r = 0;
      while (r < 15) {
        if (board[r][c] === null) { r++; continue; }
        let start = r;
        let word = '';
        while (r < 15 && board[r][c] !== null) {
          word += board[r][c];
          r++;
        }
        if (word.length >= 2) {
          if (!WORD_SET.has(word)) {
            console.error(`Invalid vertical word on board: ${word}`);
            return null; // Reject this board
          }
          allWordsValid.push(word);
        }
      }
    }
    
    return { board, premiumsUsed };
  }, [WORD_LIST, WORD_SET]);

  // ─── FIND ALL VALID PLAYS ───────────────────────────────────────
  const findAllValidPlays = useCallback((board, rack, premiumsUsed) => {
    const plays = [];
    const rackCount = {};
    rack.forEach(t => { rackCount[t] = (rackCount[t] || 0) + 1; });

    function getLetterAt(r, c) { return (r >= 0 && r < 15 && c >= 0 && c < 15) ? board[r][c] : null; }

    const anchors = new Set();
    let hasTiles = false;
    for (let r = 0; r < 15; r++) {
      for (let c = 0; c < 15; c++) {
        if (board[r][c] !== null) {
          hasTiles = true;
          [[r-1,c],[r+1,c],[r,c-1],[r,c+1]].forEach(([nr, nc]) => {
            if (nr >= 0 && nr < 15 && nc >= 0 && nc < 15 && board[nr][nc] === null) {
              anchors.add(`${nr},${nc}`);
            }
          });
        }
      }
    }

    for (const word of WORD_LIST) {
      if (word.length < 2) continue;

      for (let horizontal = 0; horizontal <= 1; horizontal++) {
        const isH = horizontal === 1;

        for (let startR = 0; startR < 15; startR++) {
          for (let startC = 0; startC < 15; startC++) {
            if (isH && startC + word.length > 15) continue;
            if (!isH && startR + word.length > 15) continue;

            let valid = true;
            let touchesExisting = false;
            let usesNewTile = false;
            const needed = { ...rackCount };
            const positions = [];

            for (let i = 0; i < word.length; i++) {
              const r = isH ? startR : startR + i;
              const c = isH ? startC + i : startC;
              positions.push([r, c]);
              const existing = board[r][c];

              if (existing !== null) {
                if (existing !== word[i]) { valid = false; break; }
                touchesExisting = true;
              } else {
                if (!needed[word[i]] || needed[word[i]] <= 0) { valid = false; break; }
                needed[word[i]]--;
                usesNewTile = true;
              }
            }

            if (!valid || !touchesExisting || !usesNewTile) continue;

            if (isH) {
              if (startC > 0 && getLetterAt(startR, startC - 1) !== null) continue;
              if (startC + word.length < 15 && getLetterAt(startR, startC + word.length) !== null) continue;
            } else {
              if (startR > 0 && getLetterAt(startR - 1, startC) !== null) continue;
              if (startR + word.length < 15 && getLetterAt(startR + word.length, startC) !== null) continue;
            }

            let crossValid = true;
            for (let i = 0; i < word.length && crossValid; i++) {
              const r = isH ? startR : startR + i;
              const c = isH ? startC + i : startC;
              if (board[r][c] !== null) continue;

              if (isH) {
                const above = getLetterAt(r - 1, c);
                const below = getLetterAt(r + 1, c);
                if (above !== null || below !== null) {
                  let cw = '';
                  let cr = r;
                  while (cr > 0 && getLetterAt(cr - 1, c) !== null) cr--;
                  while (cr < 15) {
                    const ch = (cr === r) ? word[i] : getLetterAt(cr, c);
                    if (ch === null) break;
                    cw += ch;
                    cr++;
                  }
                  if (cw.length > 1 && !WORD_SET.has(cw)) crossValid = false;
                }
              } else {
                const left = getLetterAt(r, c - 1);
                const right = getLetterAt(r, c + 1);
                if (left !== null || right !== null) {
                  let cw = '';
                  let cc = c;
                  while (cc > 0 && getLetterAt(r, cc - 1) !== null) cc--;
                  while (cc < 15) {
                    const ch = (cc === c) ? word[i] : getLetterAt(r, cc);
                    if (ch === null) break;
                    cw += ch;
                    cc++;
                  }
                  if (cw.length > 1 && !WORD_SET.has(cw)) crossValid = false;
                }
              }
            }
            if (!crossValid) continue;

            const score = scorePlay(word, positions, board, premiumsUsed, isH);
            plays.push({ word, row: startR, col: startC, horizontal: isH, score, positions });
          }
        }
      }
    }

    const seen = new Set();
    return plays.filter(p => {
      const key = `${p.word}|${p.row}|${p.col}|${p.horizontal}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  }, [WORD_LIST, WORD_SET]);

  // ─── SCORING ────────────────────────────────────────────────────
  function getPremium(r, c) {
    return BOARD_TEMPLATE[r][c] === '.' ? null : BOARD_TEMPLATE[r][c];
  }

  function scorePlay(word, positions, board, premiumsUsed, isHorizontal) {
    let mainScore = scoreOneWord(word, positions, board, premiumsUsed);

    for (let i = 0; i < word.length; i++) {
      const [r, c] = positions[i];
      if (board[r][c] !== null) continue;

      let crossWord = '';
      let crossPositions = [];

      if (isHorizontal) {
        let cr = r;
        while (cr > 0 && board[cr-1][c] !== null) cr--;
        while (cr < 15) {
          const ch = (cr === r) ? word[i] : board[cr][c];
          if (ch === null) break;
          crossWord += ch;
          crossPositions.push([cr, c]);
          cr++;
        }
      } else {
        let cc = c;
        while (cc > 0 && board[r][cc-1] !== null) cc--;
        while (cc < 15) {
          const ch = (cc === c) ? word[i] : board[r][cc];
          if (ch === null) break;
          crossWord += ch;
          crossPositions.push([r, cc]);
          cc++;
        }
      }

      if (crossWord.length > 1) {
        mainScore += scoreOneWord(crossWord, crossPositions, board, premiumsUsed);
      }
    }

    const newTiles = positions.filter(([r,c]) => board[r][c] === null).length;
    if (newTiles === 7) mainScore += 50;

    return mainScore;
  }

  function scoreOneWord(word, positions, board, premiumsUsed) {
    let wordScore = 0;
    let wordMult = 1;

    for (let i = 0; i < word.length; i++) {
      const [r, c] = positions[i];
      const key = `${r},${c}`;
      let letterVal = TV[word[i]] || 0;
      const isNew = board[r][c] === null;

      if (isNew && !premiumsUsed[key]) {
        const prem = getPremium(r, c);
        if (prem === 'DL') letterVal *= 2;
        else if (prem === 'TL') letterVal *= 3;
        else if (prem === 'DW') wordMult *= 2;
        else if (prem === 'TW') wordMult *= 3;
      }
      wordScore += letterVal;
    }
    return wordScore * wordMult;
  }

  // ─── DEFENSE HEURISTIC ──────────────────────────────────────────
  function defenseScore(play, board) {
    let score = 0;

    play.positions.forEach(([r, c]) => {
      if (board[r][c] !== null) return;
      const prem = getPremium(r, c);
      if (prem === 'TW') score += 60;
      else if (prem === 'DW') score += 25;
      else if (prem === 'TL') score += 15;
      else if (prem === 'DL') score += 8;
    });

    const twSquares = [[0,0],[0,7],[0,14],[7,0],[7,14],[14,0],[14,7],[14,14]];
    play.positions.forEach(([r, c]) => {
      if (board[r][c] !== null) return;
      twSquares.forEach(([tr, tc]) => {
        if ((r === tr || c === tc) && Math.abs(r - tr) + Math.abs(c - tc) <= 5) {
          score -= 12;
        }
      });
    });

    play.positions.forEach(([r, c]) => {
      if (board[r][c] !== null) return;
      const dist = Math.abs(r - 7) + Math.abs(c - 7);
      score -= dist * 1.5;
    });

    score -= play.word.length * 2;

    return score;
  }

  // ─── GENERATE FULL SCENARIO ─────────────────────────────────────
  const generateScenario = useCallback(() => {
    let boardData = null;
    for (let attempt = 0; attempt < 20; attempt++) {
      boardData = buildConnectedBoard();
      if (boardData) break;
    }
    if (!boardData) return null;
    const { board, premiumsUsed } = boardData;

    const commonLetters = 'AEIOUNRSTLCDGHM';
    const rareLetters = 'PBFYWVKJXQZ';
    const rack = [];
    for (let i = 0; i < 7; i++) {
      if (Math.random() < 0.75) {
        rack.push(commonLetters[Math.floor(Math.random() * commonLetters.length)]);
      } else {
        rack.push(rareLetters[Math.floor(Math.random() * rareLetters.length)]);
      }
    }

    const validPlays = findAllValidPlays(board, rack, premiumsUsed);
    if (validPlays.length < 4) return null;

    validPlays.sort((a, b) => b.score - a.score);
    const bestOffensive = validPlays[0];

    const withDef = validPlays.map(p => ({ ...p, defScore: defenseScore(p, board) }));
    withDef.sort((a, b) => b.defScore - a.defScore);
    const bestDefensive = withDef[0];

    return { board, rack, premiumsUsed, bestOffensive, bestDefensive };
  }, [buildConnectedBoard, findAllValidPlays]);

  // ─── VALIDATE USER'S PLACED TILES ──────────────────────────────
  const validatePlacement = useCallback((board, placed, premiumsUsed) => {
    const keys = Object.keys(placed);
    if (keys.length === 0) return { valid: false, error: "Place at least one tile." };

    const coords = keys.map(k => { const [r, c] = k.split(',').map(Number); return { r, c }; });
    const rows = new Set(coords.map(p => p.r));
    const cols = new Set(coords.map(p => p.c));

    let isH;
    if (rows.size === 1 && cols.size === 1) {
      isH = null;
    } else if (rows.size === 1) {
      isH = true;
    } else if (cols.size === 1) {
      isH = false;
    } else {
      return { valid: false, error: "Tiles must all be in one row or one column." };
    }

    function extractWord(horizontal) {
      let positions = [];
      if (horizontal) {
        const row = coords[0].r;
        let minC = Math.min(...coords.map(p => p.c));
        let maxC = Math.max(...coords.map(p => p.c));
        while (minC > 0 && board[row][minC - 1] !== null) minC--;
        while (maxC < 14 && board[row][maxC + 1] !== null) maxC++;
        for (let c = minC; c <= maxC; c++) {
          const letter = placed[`${row},${c}`] || board[row][c];
          if (letter === null) return null;
          positions.push({ r: row, c, letter });
        }
      } else {
        const col = coords[0].c;
        let minR = Math.min(...coords.map(p => p.r));
        let maxR = Math.max(...coords.map(p => p.r));
        while (minR > 0 && board[minR - 1][col] !== null) minR--;
        while (maxR < 14 && board[maxR + 1][col] !== null) maxR++;
        for (let r = minR; r <= maxR; r++) {
          const letter = placed[`${r},${col}`] || board[r][col];
          if (letter === null) return null;
          positions.push({ r, c: col, letter });
        }
      }
      return positions;
    }

    let wordPositions;
    if (isH === null) {
      const hW = extractWord(true);
      const vW = extractWord(false);
      if (hW && vW) {
        if (vW.length > hW.length) { isH = false; wordPositions = vW; }
        else { isH = true; wordPositions = hW; }
      } else if (hW) { isH = true; wordPositions = hW; }
      else if (vW) { isH = false; wordPositions = vW; }
      else return { valid: false, error: "No word formed." };
    } else {
      wordPositions = extractWord(isH);
    }

    if (!wordPositions) return { valid: false, error: "There is a gap in your word." };
    if (wordPositions.length < 2) return { valid: false, error: "Word must be at least 2 letters." };

    const word = wordPositions.map(p => p.letter).join('');
    const posArr = wordPositions.map(p => [p.r, p.c]);

    if (!WORD_SET.has(word)) {
      const placedLetters = keys.map(k => placed[k]).join('');
      if (word !== placedLetters) {
        return { valid: false, error: `"${word}" is not a valid word. (Your letters ${placedLetters} combined with adjacent board tiles to form "${word}".)` };
      }
      return { valid: false, error: `"${word}" is not a valid word.` };
    }

    const touchesExisting = wordPositions.some(p => board[p.r][p.c] !== null);
    
    let formsValidCrossWord = false;
    for (const { r, c, letter } of wordPositions) {
      if (board[r][c] !== null) continue;
      
      let cw = '';
      if (isH) {
        let cr = r;
        while (cr > 0 && board[cr - 1][c] !== null) cr--;
        while (cr < 15) {
          const ch = (cr === r) ? letter : board[cr][c];
          if (ch === null) break;
          cw += ch; cr++;
        }
      } else {
        let cc = c;
        while (cc > 0 && board[r][cc - 1] !== null) cc--;
        while (cc < 15) {
          const ch = (cc === c) ? letter : board[r][cc];
          if (ch === null) break;
          cw += ch; cc++;
        }
      }
      if (cw.length > 1 && WORD_SET.has(cw)) {
        formsValidCrossWord = true;
        break;
      }
    }
    
    if (!touchesExisting && !formsValidCrossWord) {
      return { valid: false, error: "Your word must connect to the existing board." };
    }

    for (const { r, c, letter } of wordPositions) {
      if (board[r][c] !== null) continue;
      let cw = '', cp = [];
      if (isH) {
        let cr = r;
        while (cr > 0 && board[cr - 1][c] !== null) cr--;
        while (cr < 15) {
          const ch = (cr === r) ? letter : board[cr][c];
          if (ch === null) break;
          cw += ch; cp.push([cr, c]); cr++;
        }
      } else {
        let cc = c;
        while (cc > 0 && board[r][cc - 1] !== null) cc--;
        while (cc < 15) {
          const ch = (cc === c) ? letter : board[r][cc];
          if (ch === null) break;
          cw += ch; cp.push([r, cc]); cc++;
        }
      }
      if (cw.length > 1 && !WORD_SET.has(cw))
        return { valid: false, error: `Cross-word "${cw}" is not valid.` };
    }

    const score = scorePlay(word, posArr, board, premiumsUsed, isH);
    return { valid: true, word, positions: posArr, horizontal: isH, score };
  }, [WORD_SET]);

  const load = useCallback(() => {
    if (WORD_LIST.length === 0) return; // Wait for dictionary
    
    setLoading(true);
    setPlaced({}); setSelRack(null); setRound('offense');
    setOffResult(null); setDefResult(null); setError(null); setDrag(null);
    setRackOrder([0,1,2,3,4,5,6]); // Reset rack arrangement
    setTimeout(() => {
      let s = null;
      for (let i = 0; i < 40; i++) { s = generateScenario(); if (s) break; }
      setScenario(s);
      setLoading(false);
    }, 350);
  }, [generateScenario, WORD_LIST.length]);
  
  useEffect(() => { 
    if (!isLoadingDict) load(); 
  }, [load, isLoadingDict]);

  const usedCounts = {};
  Object.values(placed).forEach(l => { usedCounts[l] = (usedCounts[l] || 0) + 1; });
  const rackUsed = scenario ? scenario.rack.map((letter, idx) => {
    let remaining = usedCounts[letter] || 0;
    let countBefore = 0;
    for (let i = 0; i < idx; i++) if (scenario.rack[i] === letter) countBefore++;
    return remaining > countBefore;
  }) : [];

  const cellSize = Math.floor((Math.min(440, (typeof window !== 'undefined' ? window.innerWidth : 400) - 32)) / 15);

  const hitTestBoard = (x, y) => {
    if (!boardRef.current) return null;
    const rect = boardRef.current.getBoundingClientRect();
    const gap = 1;
    const totalW = 15 * (cellSize + gap) + gap;
    const offX = rect.left + (rect.width - totalW) / 2;
    const offY = rect.top + gap;
    const c = Math.floor((x - offX) / (cellSize + gap));
    const r = Math.floor((y - offY) / (cellSize + gap));
    if (r >= 0 && r < 15 && c >= 0 && c < 15) return { r, c };
    return null;
  };

  const hitTestRack = (x, y) => {
    if (!rackRef.current) return null;
    const children = Array.from(rackRef.current.children);
    for (let i = 0; i < children.length; i++) {
      const rect = children[i].getBoundingClientRect();
      if (x >= rect.left && x <= rect.right && y >= rect.top && y <= rect.bottom) {
        return i; // Return display position
      }
    }
    return null;
  };

  const doPlace = (rackIdx, r, c) => {
    if (round === 'done') return;
    if (scenario.board[r][c] !== null) return;
    if (placed[`${r},${c}`]) return;
    setPlaced(prev => ({ ...prev, [`${r},${c}`]: scenario.rack[rackIdx] }));
    setSelRack(null);
    setError(null);
  };

  const doPickUp = (r, c) => {
    if (round === 'done') return;
    setPlaced(prev => { const n = { ...prev }; delete n[`${r},${c}`]; return n; });
    setError(null);
  };

  const onRackPointerDown = (e, displayPos) => {
    const actualIdx = rackOrder[displayPos];
    if (rackUsed[actualIdx] || round === 'done') return;
    e.preventDefault();
    e.currentTarget.setPointerCapture(e.pointerId);
    setDrag({ idx: actualIdx, displayPos, x: e.clientX, y: e.clientY, startedOnRack: true });
    setSelRack(actualIdx);
  };

  const onPointerMove = (e) => {
    if (!drag) return;
    e.preventDefault();
    setDrag(prev => {
      if (!prev) return null;
      const rackPos = hitTestRack(e.clientX, e.clientY);
      return { ...prev, x: e.clientX, y: e.clientY, hoverRackPos: rackPos };
    });
  };

  const onPointerUp = (e) => {
    if (!drag) return;
    e.preventDefault();
    
    // Check if dropped on rack (for rearranging)
    const rackPos = hitTestRack(e.clientX, e.clientY);
    if (rackPos !== null && rackPos !== drag.displayPos) {
      // Swap tiles in rack
      setRackOrder(prev => {
        const newOrder = [...prev];
        const temp = newOrder[drag.displayPos];
        newOrder[drag.displayPos] = newOrder[rackPos];
        newOrder[rackPos] = temp;
        return newOrder;
      });
      setDrag(null);
      return;
    }
    
    // Check if dropped on board (for placing)
    const cell = hitTestBoard(e.clientX, e.clientY);
    if (cell) {
      const actualIdx = rackOrder[drag.displayPos];
      doPlace(actualIdx, cell.r, cell.c);
    }
    setDrag(null);
  };

  const onCellClick = (r, c) => {
    if (round === 'done') return;
    const key = `${r},${c}`;
    if (placed[key]) { doPickUp(r, c); return; }
    if (selRack !== null && scenario.board[r][c] === null) {
      doPlace(selRack, r, c); // selRack is already the actual index
    }
  };

  const onRackClick = (displayPos) => {
    const actualIdx = rackOrder[displayPos];
    if (rackUsed[actualIdx] || round === 'done') return;
    setSelRack(selRack === actualIdx ? null : actualIdx);
  };

  const onSubmit = () => {
    const v = validatePlacement(scenario.board, placed, scenario.premiumsUsed);
    if (!v.valid) { setError(v.error); return; }
    setError(null);
    if (round === 'offense') {
      const match = scenario.bestOffensive && v.score >= scenario.bestOffensive.score;
      setOffResult({ word: v.word, score: v.score, match });
      setRound('defense');
      setPlaced({});
      setSelRack(null);
    } else {
      const userDefScore = defenseScore({ positions: v.positions, word: v.word }, scenario.board);
      const match = scenario.bestDefensive && userDefScore >= scenario.bestDefensive.defScore;
      setDefResult({ word: v.word, score: v.score, match });
      setRound('done');
      setStats(prev => ({
        played: prev.played + 1,
        offOk: prev.offOk + (offResult && offResult.match ? 1 : 0),
        defOk: prev.defOk + (match ? 1 : 0),
      }));
    }
  };

  const premColors = { TW: '#c0392b', DW: '#e67e22', TL: '#2980b9', DL: '#5dade2' };
  const premLabels = { TW: '3×\nWORD', DW: '2×\nWORD', TL: '3×\nLTR', DL: '2×\nLTR' };

  if (loading || !scenario || isLoadingDict) return (
    <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', background: '#1a1a2e' }}>
      <div style={{ color: '#d4a843', fontSize: 22, textAlign: 'center', fontFamily: "'Palatino Linotype',serif" }}>
        <div style={{ fontSize: 38, marginBottom: 10 }}>🔤</div>
        {isLoadingDict ? 'Loading dictionary...' : 'Generating scenario…'}
      </div>
    </div>
  );

  const isActive = round !== 'done';
  const phaseLabel = round === 'done' ? '📊 Results' : round === 'defense' ? '🛡️ Best Defense' : '⚔️ Best Offense';

  const validWordCells = new Set();
  let liveScore = 0;
  let liveWords = [];
  if (Object.keys(placed).length > 0 && scenario) {
    const merged = scenario.board.map(row => [...row]);
    Object.entries(placed).forEach(([key, letter]) => {
      const [r, c] = key.split(',').map(Number);
      merged[r][c] = letter;
    });
    const placedSet = new Set(Object.keys(placed));
    const wordCells = [];
    const checkedRuns = new Set();

    for (let r = 0; r < 15; r++) {
      let c = 0;
      while (c < 15) {
        if (merged[r][c] === null) { c++; continue; }
        let start = c;
        while (c < 15 && merged[r][c] !== null) c++;
        if (c - start < 2) continue;
        const runKey = 'H' + r + ':' + start + ':' + c;
        if (checkedRuns.has(runKey)) continue;
        checkedRuns.add(runKey);
        let hasPlaced = false, word = '', cells = [];
        for (let cc = start; cc < c; cc++) {
          if (placedSet.has(r + ',' + cc)) hasPlaced = true;
          word += merged[r][cc];
          cells.push([r, cc]);
        }
        if (hasPlaced && WORD_SET.has(word)) {
          wordCells.push({ word, cells, horizontal: true });
        }
      }
    }

    for (let c = 0; c < 15; c++) {
      let r = 0;
      while (r < 15) {
        if (merged[r][c] === null) { r++; continue; }
        let start = r;
        while (r < 15 && merged[r][c] !== null) r++;
        if (r - start < 2) continue;
        const runKey = 'V' + c + ':' + start + ':' + r;
        if (checkedRuns.has(runKey)) continue;
        checkedRuns.add(runKey);
        let hasPlaced = false, word = '', cells = [];
        for (let rr = start; rr < r; rr++) {
          if (placedSet.has(rr + ',' + c)) hasPlaced = true;
          word += merged[rr][c];
          cells.push([rr, c]);
        }
        if (hasPlaced && WORD_SET.has(word)) {
          wordCells.push({ word, cells, horizontal: false });
        }
      }
    }
    
    wordCells.forEach(({ word, cells }) => {
      cells.forEach(([r,c]) => validWordCells.add(r+','+c));
      const wordScore = scoreOneWord(word, cells, scenario.board, scenario.premiumsUsed);
      liveScore += wordScore;
      liveWords.push(word);
    });
  }

  return (
    <div
      style={{ minHeight: '100vh', background: 'linear-gradient(180deg,#1a1a2e 0%,#16213e 50%,#0f3460 100%)', fontFamily: "'Palatino Linotype','Book Antiqua',Palatino,serif", color: '#fff', padding: '10px 14px', boxSizing: 'border-box', userSelect: 'none', touchAction: 'manipulation' }}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
    >
      <div style={{ textAlign: 'center', marginBottom: 2 }}>
        <h1 style={{ margin: 0, fontSize: 20, fontWeight: 700, letterSpacing: 4, textTransform: 'uppercase', background: 'linear-gradient(90deg,#c9a44a,#f0dcc0,#c9a44a)', WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent' }}>Scrabble Strategy Trainer</h1>
      </div>

      <div style={{ display: 'flex', justifyContent: 'center', gap: 24, marginBottom: 4 }}>
        {[
          { label: 'Rounds', val: stats.played, color: '#c9a44a' },
          { label: 'Attack %', val: stats.played ? `${Math.round(stats.offOk / stats.played * 100)}%` : '—', color: '#e74c3c' },
          { label: 'Defense %', val: stats.played ? `${Math.round(stats.defOk / stats.played * 100)}%` : '—', color: '#3498db' },
        ].map((s, i) => (
          <div key={i} style={{ textAlign: 'center' }}>
            <div style={{ fontSize: 15, fontWeight: 700, color: s.color }}>{s.val}</div>
            <div style={{ fontSize: 8, color: '#555', textTransform: 'uppercase', letterSpacing: 1 }}>{s.label}</div>
          </div>
        ))}
      </div>

      <div style={{ textAlign: 'center', fontSize: 13, fontWeight: 700, color: round === 'done' ? '#c9a44a' : round === 'defense' ? '#3498db' : '#e74c3c', letterSpacing: 1, marginBottom: 1 }}>{phaseLabel}</div>
      {isActive && (
        <div style={{ textAlign: 'center', fontSize: 10, color: '#666', marginBottom: 3 }}>
          {round === 'defense'
            ? 'Now place tiles for the move that best controls the board.'
            : 'Tap a rack tile then tap the board — or drag tiles into place.'}
        </div>
      )}

      <div ref={boardRef} style={{ display: 'flex', justifyContent: 'center' }}>
        <div style={{ display: 'grid', gridTemplateColumns: `repeat(15,${cellSize}px)`, gridTemplateRows: `repeat(15,${cellSize}px)`, gap: '1px', background: '#1a1a2e', padding: '1px', borderRadius: 6 }}>
          {Array.from({ length: 15 }, (_, r) => Array.from({ length: 15 }, (_, c) => {
            const key = `${r},${c}`;
            const boardLetter = scenario.board[r][c];
            const myLetter = placed[key] || null;
            const prem = getPremium(r, c);
            const isCenter = r === 7 && c === 7;
            const display = boardLetter || myLetter;
            const isMyTile = !boardLetter && myLetter;
            const isDropTarget = selRack !== null && !boardLetter && !myLetter && isActive;

            let bg = '#f5e6c8';
            if (boardLetter) bg = '#d4a843';
            else if (isMyTile) bg = validWordCells.has(key) ? '#27ae60' : '#7d3c98';
            else if (prem === 'TW') bg = premColors.TW;
            else if (prem === 'DW') bg = premColors.DW;
            else if (prem === 'TL') bg = premColors.TL;
            else if (prem === 'DL') bg = premColors.DL;
            else if (isCenter) bg = '#e74c3c';

            return (
              <div
                key={key}
                onClick={() => onCellClick(r, c)}
                style={{
                  width: cellSize, height: cellSize, background: bg,
                  display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
                  position: 'relative',
                  cursor: (isMyTile || isDropTarget) ? 'pointer' : 'default',
                  boxShadow: isDropTarget ? 'inset 0 0 0 2px rgba(255,255,255,0.7), 0 0 6px rgba(255,255,255,0.3)' : isMyTile ? 'inset 0 0 0 2px #fff' : 'none',
                }}
              >
                {display ? (
                  <>
                    <span style={{ fontSize: cellSize * 0.68, fontWeight: 700, color: isMyTile ? '#fff' : '#1a1a2e', fontFamily: "'Palatino Linotype',serif", lineHeight: 1, textShadow: isMyTile ? '0 1px 4px rgba(0,0,0,0.5)' : 'none' }}>{display}</span>
                    <span style={{ fontSize: cellSize * 0.34, fontWeight: 700, color: isMyTile ? 'rgba(255,255,255,0.85)' : '#6d5a2a', position: 'absolute', bottom: 1, right: 2 }}>{TV[display]}</span>
                  </>
                ) : (
                  <>
                    {prem && (
                      <span style={{ fontSize: cellSize * 0.27, color: '#fff', fontWeight: 700, textAlign: 'center', lineHeight: 1.15, fontFamily: "'Arial Narrow',Arial,sans-serif", textShadow: '0 1px 2px rgba(0,0,0,0.3)' }}>
                        {premLabels[prem].split('\n').map((l, i) => <span key={i} style={{ display: 'block' }}>{l}</span>)}
                      </span>
                    )}
                    {isCenter && !prem && <span style={{ fontSize: cellSize * 0.68, color: '#fff', opacity: 0.8 }}>★</span>}
                  </>
                )}
              </div>
            );
          }))}
        </div>
      </div>

      <div style={{ textAlign: 'center', fontSize: 9, color: '#555', letterSpacing: 1.5, textTransform: 'uppercase', marginTop: 7 }}>Your Rack</div>
      <div ref={rackRef} style={{ display: 'flex', justifyContent: 'center', gap: 3, margin: '3px 0' }}>
        {rackOrder.map((actualIdx, displayPos) => {
          const t = scenario.rack[actualIdx];
          const used = rackUsed[actualIdx];
          const isSel = selRack === actualIdx;
          const isHovered = drag && drag.hoverRackPos === displayPos && drag.displayPos !== displayPos;
          return (
            <div
              key={displayPos}
              onClick={() => onRackClick(displayPos)}
              onPointerDown={(e) => onRackPointerDown(e, displayPos)}
              style={{
                width: 38, height: 42,
                background: used ? '#2a2a2a' : 'linear-gradient(160deg,#f0dcc0 0%,#c9a44a 100%)',
                borderRadius: 4,
                border: `2px solid ${isHovered ? '#27ae60' : isSel ? '#fff' : used ? '#444' : '#a07830'}`,
                boxShadow: isHovered ? '0 0 12px rgba(39,174,96,0.6)' : isSel ? '0 0 10px rgba(255,255,255,0.5)' : '0 2px 4px rgba(0,0,0,0.35)',
                display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
                cursor: used ? 'default' : 'pointer',
                opacity: used ? 0.35 : 1,
                touchAction: 'none',
                transition: 'border 0.1s, box-shadow 0.1s',
              }}
            >
              <span style={{ fontSize: 22, fontWeight: 700, color: used ? '#555' : '#1a1a2e', fontFamily: "'Palatino Linotype',serif", lineHeight: 1 }}>{t}</span>
              <span style={{ fontSize: 11, fontWeight: 700, color: used ? '#444' : '#6d5a2a' }}>{TV[t]}</span>
            </div>
          );
        })}
      </div>

      <div style={{ display: 'flex', justifyContent: 'center', gap: 10, flexWrap: 'wrap', marginTop: 4, marginBottom: 2 }}>
        {[{ color: '#c0392b', label: '3× Word' }, { color: '#e67e22', label: '2× Word' }, { color: '#2980b9', label: '3× Letter' }, { color: '#5dade2', label: '2× Letter' }, { color: '#d4a843', label: 'On Board' }, { color: '#7d3c98', label: 'Placed' }, { color: '#27ae60', label: 'Valid Word' }].map((item, i) => (
          <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 3, fontSize: 9, color: '#999' }}>
            <div style={{ width: 9, height: 9, background: item.color, borderRadius: 2 }} />
            {item.label}
          </div>
        ))}
      </div>

      {Object.keys(placed).length > 0 && isActive && (
        <div style={{ textAlign: 'center', marginTop: 5, marginBottom: 2 }}>
          {liveWords.length > 0 ? (
            <div style={{ display: 'inline-flex', alignItems: 'center', gap: 8, background: 'rgba(39,174,96,0.15)', border: '1px solid #27ae60', borderRadius: 20, padding: '4px 12px' }}>
              <span style={{ fontSize: 11, color: '#27ae60', fontWeight: 700 }}>
                {liveWords.join(' + ')}
              </span>
              <span style={{ fontSize: 13, color: '#27ae60', fontWeight: 800 }}>
                {liveScore} pts
              </span>
            </div>
          ) : (
            <div style={{ fontSize: 11, color: '#666', fontStyle: 'italic' }}>No valid word yet</div>
          )}
        </div>
      )}

      {error && (
        <div style={{ background: '#c0392b', color: '#fff', borderRadius: 8, padding: '7px 12px', textAlign: 'center', fontSize: 13, marginTop: 4, fontWeight: 600 }}>{error}</div>
      )}

      {offResult && round !== 'done' && (
        <div style={{ background: '#fff', borderRadius: 8, padding: '8px 10px', marginTop: 6, color: '#1a1a2e', border: `2px solid ${offResult.match ? '#27ae60' : '#e67e22'}` }}>
          <div style={{ fontSize: 11, fontWeight: 700, color: offResult.match ? '#27ae60' : '#e67e22', marginBottom: 2 }}>
            ⚔️ Offense {offResult.match ? '✓ Optimal!' : '— not the best play'}
          </div>
          <div style={{ fontSize: 11, color: '#555' }}><strong>Your play:</strong> {offResult.word} — {offResult.score} pts</div>
          {!offResult.match && scenario.bestOffensive && (
            <div style={{ fontSize: 11, color: '#c0392b', marginTop: 1 }}>
              <strong>Best:</strong> {scenario.bestOffensive.word} — {scenario.bestOffensive.score} pts
            </div>
          )}
        </div>
      )}

      {isActive && (
        <div style={{ display: 'flex', gap: 6, marginTop: 6 }}>
          <button
            onClick={() => { setPlaced({}); setSelRack(null); setError(null); }}
            style={{ flex: 1, padding: '8px 0', background: '#2a2a3e', color: '#aaa', border: '1px solid #444', borderRadius: 6, fontSize: 12, fontWeight: 600, cursor: 'pointer', letterSpacing: 1, fontFamily: "'Palatino Linotype',serif" }}
          >CLEAR</button>
          <button
            onClick={onSubmit}
            disabled={Object.keys(placed).length === 0}
            style={{
              flex: 2, padding: '8px 0',
              background: Object.keys(placed).length > 0 ? 'linear-gradient(135deg,#c9a44a,#a07830)' : '#2a2a3e',
              color: '#fff', border: 'none', borderRadius: 6, fontSize: 13, fontWeight: 700,
              cursor: Object.keys(placed).length > 0 ? 'pointer' : 'not-allowed',
              letterSpacing: 2, fontFamily: "'Palatino Linotype',serif",
              boxShadow: Object.keys(placed).length > 0 ? '0 3px 8px rgba(192,148,68,0.35)' : 'none',
              opacity: Object.keys(placed).length > 0 ? 1 : 0.5,
            }}
          >{round === 'defense' ? 'SUBMIT DEFENSE →' : 'SUBMIT OFFENSE →'}</button>
        </div>
      )}

      {round === 'done' && offResult && defResult && (
        <div style={{ marginTop: 8 }}>
          <div style={{
            background: (offResult.match && defResult.match) ? '#27ae60' : (offResult.match || defResult.match) ? '#e67e22' : '#c0392b',
            color: '#fff', borderRadius: 10, padding: '9px 14px', textAlign: 'center', fontSize: 16, fontWeight: 700,
            boxShadow: '0 3px 10px rgba(0,0,0,0.25)',
          }}>
            {(offResult.match && defResult.match) ? '🎉 Perfect Round!' : (offResult.match) ? '⚔️ Great Attack!' : (defResult.match) ? '🛡️ Good Defense!' : '📚 Study Up!'}
          </div>
          <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
            {[
              { label: '⚔️ Offense', res: offResult, best: scenario.bestOffensive },
              { label: '🛡️ Defense', res: defResult, best: scenario.bestDefensive },
            ].map((item, idx) => (
              <div key={idx} style={{ flex: 1, background: '#fff', borderRadius: 8, padding: 10, border: `2px solid ${item.res.match ? '#27ae60' : '#c0392b'}`, color: '#1a1a2e' }}>
                <div style={{ fontSize: 11, fontWeight: 700, color: item.res.match ? '#27ae60' : '#c0392b', marginBottom: 3 }}>{item.label} {item.res.match ? '✓' : '✗'}</div>
                <div style={{ fontSize: 11, color: '#555' }}><strong>Yours:</strong> {item.res.word} ({item.res.score} pts)</div>
                {!item.res.match && item.best && (
                  <div style={{ fontSize: 11, color: '#c0392b', marginTop: 2 }}><strong>Best:</strong> {item.best.word} ({item.best.score} pts)</div>
                )}
              </div>
            ))}
          </div>
          <button onClick={load} style={{ width: '100%', marginTop: 10, padding: '12px 0', background: 'linear-gradient(135deg,#c9a44a,#a07830)', color: '#fff', border: 'none', borderRadius: 10, fontSize: 14, fontWeight: 700, letterSpacing: 2, cursor: 'pointer', boxShadow: '0 4px 12px rgba(192,148,68,0.4)', fontFamily: "'Palatino Linotype',serif" }}>
            NEXT SCENARIO →
          </button>
        </div>
      )}

      {drag && (
        <div style={{
          position: 'fixed', left: drag.x - 19, top: drag.y - 21, width: 38, height: 42, pointerEvents: 'none', zIndex: 9999,
          background: 'linear-gradient(160deg,#f0dcc0,#c9a44a)', borderRadius: 4, border: '2px solid #fff',
          boxShadow: '0 6px 16px rgba(0,0,0,0.45)', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
        }}>
          <span style={{ fontSize: 22, fontWeight: 700, color: '#1a1a2e', fontFamily: "'Palatino Linotype',serif", lineHeight: 1 }}>{scenario.rack[drag.idx]}</span>
          <span style={{ fontSize: 11, fontWeight: 700, color: '#6d5a2a' }}>{TV[scenario.rack[drag.idx]]}</span>
        </div>
      )}
    </div>
  );
}
