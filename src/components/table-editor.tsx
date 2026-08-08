"use client";

import React, { useState, useEffect, useCallback } from 'react';
import { parseMarkdownToMatrix, matrixToMarkdown } from '../lib/md-table';
import { get, set } from 'idb-keyval';
import { Plus, Trash2, Copy } from 'lucide-react';
import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

const STORAGE_KEY = 'md-table-state';

export default function TableEditor() {
  const [headers, setHeaders] = useState<string[]>(['Column 1', 'Column 2', 'Column 3']);
  const [rows, setRows] = useState<string[][]>([['', '', ''], ['', '', '']]);
  const [markdownOutput, setMarkdownOutput] = useState<string>('');
  const [isLoaded, setIsLoaded] = useState(false);

  // Load from IndexedDB on mount
  useEffect(() => {
    get(STORAGE_KEY).then((data) => {
      if (data && data.headers && data.rows) {
        setHeaders(data.headers);
        setRows(data.rows);
      }
      setIsLoaded(true);
    });
  }, []);

  // Save to IndexedDB and update Markdown when matrix changes
  useEffect(() => {
    if (isLoaded) {
      set(STORAGE_KEY, { headers, rows });
      setMarkdownOutput(matrixToMarkdown(headers, rows));
    }
  }, [headers, rows, isLoaded]);

  // Update cell value
  const updateCell = useCallback((rowIndex: number, colIndex: number, value: string) => {
    setRows(old => old.map((row, r) => r === rowIndex ? row.map((cell, c) => c === colIndex ? value : cell) : row));
  }, []);

  // Update header value
  const updateHeader = useCallback((colIndex: number, value: string) => {
    setHeaders(old => old.map((header, c) => c === colIndex ? value : header));
  }, []);

  const addRow = () => {
    setRows(old => [...old, new Array(headers.length).fill('')]);
  };

  const addColumn = () => {
    setHeaders(old => [...old, `Column ${old.length + 1}`]);
    setRows(old => old.map(row => [...row, '']));
  };

  const deleteRow = (rowIndex: number) => {
    if (rows.length > 1) {
      setRows(old => old.filter((_, r) => r !== rowIndex));
    }
  };

  const deleteColumn = (colIndex: number) => {
    if (headers.length > 1) {
      setHeaders(old => old.filter((_, c) => c !== colIndex));
      setRows(old => old.map(row => row.filter((_, c) => c !== colIndex)));
    }
  };

  const handlePaste = (e: React.ClipboardEvent<HTMLDivElement>) => {
    const text = e.clipboardData.getData('text/plain');
    if (text) {
      // Basic heuristic for TSV
      if (text.includes('\t')) {
        e.preventDefault();
        const lines = text.split('\n').map(line => line.split('\t'));
        
        let maxCols = headers.length;
        lines.forEach(line => {
          if (line.length > maxCols) maxCols = line.length;
        });

        const newHeaders = [...headers];
        while(newHeaders.length < maxCols) {
          newHeaders.push(`Column ${newHeaders.length + 1}`);
        }

        const newRows = [...rows];
        lines.forEach(line => {
          if (line.length === 1 && line[0].trim() === '') return;
          const newRow = new Array(maxCols).fill('');
          line.forEach((cell, i) => {
             newRow[i] = cell.trim();
          });
          newRows.push(newRow);
        });

        setHeaders(newHeaders);
        setRows(newRows);
      }
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement | HTMLInputElement>, rowIndex: number | 'header', colIndex: number) => {
    const target = e.target as HTMLTextAreaElement | HTMLInputElement;
    const isAtStart = target.selectionStart === 0;
    const isAtEnd = target.selectionEnd === target.value.length;

    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      focusCell(rowIndex === 'header' ? 0 : rowIndex + 1, colIndex);
    } else if (e.key === 'ArrowUp' && isAtStart) {
      e.preventDefault();
      focusCell(rowIndex === 'header' ? 'header' : rowIndex - 1, colIndex);
    } else if (e.key === 'ArrowDown' && isAtEnd) {
      e.preventDefault();
      focusCell(rowIndex === 'header' ? 0 : rowIndex + 1, colIndex);
    }
  };

  const focusCell = (rowIndex: number | 'header', colIndex: number) => {
    const rId = rowIndex === 'header' ? 'header' : rowIndex;
    const el = document.getElementById(`cell-${rId}-${colIndex}`);
    if (el) {
      el.focus();
    }
  };

  const copyToClipboard = () => {
    navigator.clipboard.writeText(markdownOutput);
  };

  const parseFromMarkdown = (md: string) => {
    setMarkdownOutput(md);
    const { headers: newHeaders, rows: newRows } = parseMarkdownToMatrix(md);
    setHeaders(newHeaders);
    setRows(newRows);
  };

  if (!isLoaded) return <div className="flex h-screen items-center justify-center bg-gray-50 dark:bg-gray-900 text-gray-500">Loading editor...</div>;

  return (
    <div className="flex flex-col md:flex-row gap-6 p-6 min-h-screen bg-gray-50 dark:bg-gray-950 text-gray-900 dark:text-gray-100 font-sans">
      
      {/* Editor Section */}
      <div className="flex-1 flex flex-col gap-4 overflow-hidden">
        <div className="flex items-center justify-between">
          <h1 className="text-3xl font-extrabold tracking-tight bg-gradient-to-r from-blue-600 to-indigo-600 bg-clip-text text-transparent">GridMD Editor</h1>
          <div className="flex gap-3">
            <button onClick={addColumn} className="flex items-center gap-2 px-4 py-2 bg-blue-600/10 hover:bg-blue-600/20 text-blue-600 dark:text-blue-400 font-medium rounded-lg transition-colors">
              <Plus size={18} /> Add Column
            </button>
            <button onClick={addRow} className="flex items-center gap-2 px-4 py-2 bg-indigo-600 hover:bg-indigo-700 text-white font-medium rounded-lg shadow-md transition-colors">
              <Plus size={18} /> Add Row
            </button>
          </div>
        </div>

        <div 
          className="flex-1 overflow-auto bg-white dark:bg-gray-900 rounded-2xl shadow-xl border border-gray-200/50 dark:border-gray-800 p-6"
          onPaste={handlePaste}
        >
          <div className="min-w-max grid gap-y-1" style={{ gridTemplateColumns: `repeat(${headers.length}, minmax(180px, 1fr)) 48px` }}>
            {/* Headers */}
            {headers.map((header, cIndex) => (
              <div key={`header-${cIndex}`} className="p-2 font-semibold flex items-center gap-2 group border-b-2 border-gray-200 dark:border-gray-800 bg-gray-50/50 dark:bg-gray-800/20 rounded-t-lg">
                <input
                  id={`cell-header-${cIndex}`}
                  value={header}
                  onChange={(e) => updateHeader(cIndex, e.target.value)}
                  onKeyDown={(e) => handleKeyDown(e, 'header', cIndex)}
                  className="w-full px-3 py-2 bg-transparent focus:bg-white dark:focus:bg-gray-800 outline-none rounded-md border border-transparent focus:border-blue-500/50 focus:ring-2 focus:ring-blue-500/20 transition-all font-semibold"
                  placeholder={`Column ${cIndex + 1}`}
                />
                <button 
                  onClick={() => deleteColumn(cIndex)}
                  className="opacity-0 group-hover:opacity-100 text-red-400 hover:text-red-600 hover:bg-red-50 dark:hover:bg-red-900/30 p-1.5 rounded-md transition-all"
                  title="Delete column"
                >
                  <Trash2 size={16} />
                </button>
              </div>
            ))}
            <div className="border-b-2 border-gray-200 dark:border-gray-800"></div>

            {/* Rows */}
            {rows.map((row, rIndex) => (
              <React.Fragment key={`row-${rIndex}`}>
                {row.map((cell, cIndex) => (
                  <div key={`cell-${rIndex}-${cIndex}`} className="p-2 border-b border-gray-100 dark:border-gray-800/50 group/cell">
                     <textarea
                      id={`cell-${rIndex}-${cIndex}`}
                      value={cell}
                      onChange={(e) => updateCell(rIndex, cIndex, e.target.value)}
                      onKeyDown={(e) => handleKeyDown(e, rIndex, cIndex)}
                      className="w-full px-3 py-2 bg-transparent focus:bg-white dark:focus:bg-gray-800 outline-none rounded-md border border-transparent focus:border-blue-500/50 focus:ring-2 focus:ring-blue-500/20 transition-all resize-none overflow-hidden"
                      rows={1}
                      placeholder="..."
                      onInput={(e) => {
                         e.currentTarget.style.height = 'auto';
                         e.currentTarget.style.height = e.currentTarget.scrollHeight + 'px';
                      }}
                    />
                  </div>
                ))}
                {/* Delete Row Button */}
                <div className="flex items-center justify-center p-2 border-b border-gray-100 dark:border-gray-800/50">
                  <button 
                    onClick={() => deleteRow(rIndex)}
                    className="text-gray-300 hover:text-red-500 hover:bg-red-50 dark:hover:bg-red-900/30 p-2 rounded-lg transition-all"
                    title="Delete row"
                  >
                    <Trash2 size={18} />
                  </button>
                </div>
              </React.Fragment>
            ))}
          </div>
        </div>
      </div>

      {/* Output Section */}
      <div className="w-full md:w-[400px] flex flex-col gap-4">
         <div className="flex items-center justify-between">
           <h2 className="text-xl font-bold text-gray-700 dark:text-gray-300">Markdown</h2>
           <button onClick={copyToClipboard} className="flex items-center gap-2 px-3 py-1.5 bg-gray-200 hover:bg-gray-300 dark:bg-gray-800 dark:hover:bg-gray-700 font-medium rounded-lg text-sm shadow-sm transition-colors">
              <Copy size={16} /> Copy
           </button>
         </div>
         
         <textarea
           value={markdownOutput}
           onChange={(e) => parseFromMarkdown(e.target.value)}
           className="flex-1 w-full p-5 font-mono text-sm leading-relaxed bg-white dark:bg-gray-900 rounded-2xl shadow-xl border border-gray-200/50 dark:border-gray-800 outline-none focus:ring-2 focus:ring-indigo-500/50 focus:border-indigo-500/50 resize-none whitespace-pre transition-all"
           placeholder="Paste Markdown table here..."
         />
      </div>

    </div>
  );
}
