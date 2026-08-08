"use client";

import React, { useState, useEffect, useRef, useCallback } from 'react';
import { parseMarkdownToMatrix, matrixToMarkdown } from '../lib/md-table';
import { get, set } from 'idb-keyval';
import { Copy, Wand2 } from 'lucide-react';
import { createUniver, defaultTheme, LocaleType, mergeLocales } from '@univerjs/presets';
import { UniverSheetsCorePreset } from '@univerjs/preset-sheets-core';
// @ts-expect-error Types are missing for the locale file
import enUS from '@univerjs/preset-sheets-core/lib/locales/en-US.js';

// Import the bundled CSS for the entire sheets preset
import '@univerjs/preset-sheets-core/lib/index.css';

const STORAGE_KEY = 'md-table-state-v2';

/**
 * Extract active sheet matrix from Univer
 */
function getSheetMatrix(univerAPI: any): string[][] {
  try {
    const workbook = univerAPI.getActiveWorkbook();
    if (!workbook) return [];
    const sheet = workbook.getActiveSheet();
    if (!sheet) return [];

    let cellData = null;
    if (typeof sheet.getSheet === 'function') {
      cellData = sheet.getSheet().getSnapshot()?.cellData;
    } else if (typeof sheet.getSnapshot === 'function') {
      cellData = sheet.getSnapshot()?.cellData;
    }

    if (cellData) {
      const rowIndices = Object.keys(cellData).map(Number).sort((a, b) => a - b);
      if (rowIndices.length === 0) return [];

      const matrix: string[][] = [];
      rowIndices.forEach((r) => {
        matrix[r] = [];
        const colObj = cellData[r] || {};
        Object.keys(colObj).forEach((c) => {
          const cIdx = Number(c);
          const cellObj = colObj[cIdx];
          let val = '';
          if (cellObj) {
            val = cellObj.v !== undefined && cellObj.v !== null ? String(cellObj.v) : (cellObj.m || cellObj.p || '');
          }
          matrix[r][cIdx] = val;
        });
      });

      // Fill in undefined slots with empty strings
      for (let r = 0; r < matrix.length; r++) {
        if (!matrix[r]) matrix[r] = [];
        for (let c = 0; c < matrix[r].length; c++) {
          if (matrix[r][c] === undefined) matrix[r][c] = '';
        }
      }

      return matrix;
    }
  } catch (err) {
    console.error("Error reading sheet matrix:", err);
  }
  return [];
}

/**
 * Build Univer cellData format from a 2D values array.
 */
function buildCellData(values: string[][]): Record<number, Record<number, { v: string | number }>> {
  const cellData: Record<number, Record<number, { v: string | number }>> = {};
  for (let r = 0; r < values.length; r++) {
    cellData[r] = {};
    for (let c = 0; c < values[r].length; c++) {
      let val: string | number = values[r][c];
      if (val !== '' && !isNaN(Number(val))) {
        val = Number(val);
      }
      cellData[r][c] = { v: val };
    }
  }
  return cellData;
}

export default function TableEditor() {
  const containerRef = useRef<HTMLDivElement>(null);
  const [markdownOutput, setMarkdownOutput] = useState<string>('');
  const univerRef = useRef<any>(null);
  // Guard flag to prevent circular sync loops
  const suppressSyncRef = useRef<boolean>(false);
  // Track the dispose function for the command listener
  const listenerDisposeRef = useRef<any>(null);

  /**
   * Read sheet data → update markdown + persist.
   * Called automatically when the sheet changes.
   */
  const syncSheetToMarkdown = useCallback(() => {
    const api = univerRef.current;
    if (!api) return;

    const matrix = getSheetMatrix(api);
    if (!matrix || matrix.length === 0) return;

    // Filter out completely empty rows and columns for markdown
    const maxRow = matrix.length - 1;
    let maxCol = -1;
    for (let r = 0; r <= maxRow; r++) {
      for (let c = 0; c < (matrix[r]?.length || 0); c++) {
        if (matrix[r][c] !== '') {
          if (c > maxCol) maxCol = c;
        }
      }
    }

    if (maxCol < 0) return; // Empty sheet

    const headers: string[] = [];
    for (let c = 0; c <= maxCol; c++) {
      headers.push(matrix[0]?.[c] || '');
    }

    const rows: string[][] = [];
    for (let r = 1; r <= maxRow; r++) {
      const row: string[] = [];
      for (let c = 0; c <= maxCol; c++) {
        row.push(matrix[r]?.[c] || '');
      }
      rows.push(row);
    }

    const md = matrixToMarkdown(headers, rows);
    setMarkdownOutput(md);
    set(STORAGE_KEY, { headers, rows });
  }, []);

  /**
   * Attach a command listener to the Univer instance so that any cell edit
   * automatically pushes changes to the markdown textarea.
   */
  const attachSheetListener = useCallback((api: any) => {
    // Dispose any previous listener
    if (listenerDisposeRef.current) {
      listenerDisposeRef.current.dispose();
      listenerDisposeRef.current = null;
    }

    const debouncedSync = (() => {
      let timer: ReturnType<typeof setTimeout> | null = null;
      return () => {
        if (timer) clearTimeout(timer);
        timer = setTimeout(() => {
          if (!suppressSyncRef.current) {
            syncSheetToMarkdown();
          }
        }, 100);
      };
    })();

    // Primary: use onCommandExecuted which fires for all mutations including
    // cell edits, paste, delete, undo/redo. This is more reliable than addEvent
    // for catching every type of sheet mutation.
    const commandDisposable = api.onCommandExecuted((commandInfo: any) => {
      if (suppressSyncRef.current) return;
      // Filter to only sheet-mutation-related commands
      const id = commandInfo.id || '';
      if (
        id.includes('set-range-values') ||
        id.includes('set-cell') ||
        id.includes('remove-') ||
        id.includes('insert-') ||
        id.includes('delete-') ||
        id.includes('clear-') ||
        id.includes('paste') ||
        id.includes('undo') ||
        id.includes('redo') ||
        id.includes('mutation')
      ) {
        debouncedSync();
      }
    });

    // Secondary: also attach SheetValueChanged event as a backup
    let eventDisposable: any = null;
    try {
      eventDisposable = api.addEvent(api.Event.SheetValueChanged, () => {
        if (suppressSyncRef.current) return;
        debouncedSync();
      });
    } catch (e) {
      console.warn('SheetValueChanged event not available, using command listener only', e);
    }

    // Store both disposables
    listenerDisposeRef.current = {
      dispose: () => {
        commandDisposable?.dispose();
        eventDisposable?.dispose();
      }
    };
  }, [syncSheetToMarkdown]);

  // Initialize Univer
  useEffect(() => {
    if (!containerRef.current) return;

    const { univerAPI } = createUniver({
      locale: LocaleType.EN_US,
      locales: {
        [LocaleType.EN_US]: mergeLocales(enUS),
      },
      theme: defaultTheme,
      presets: [
        UniverSheetsCorePreset({
          container: containerRef.current,
        }),
      ],
    });

    univerRef.current = univerAPI;

    // Load initial state from IDB
    get(STORAGE_KEY).then((data) => {
      let headers = ['Column 1', 'Column 2'];
      let rows = [['', '']];

      if (data && data.headers && data.rows) {
        headers = data.headers;
        rows = data.rows;
      }

      const values = [headers, ...rows];
      const cellData = buildCellData(values);

      univerAPI.createUniverSheet({
        id: 'sheet-1',
        name: 'Markdown Table',
        sheets: {
          'sheet-1': {
            id: 'sheet-1',
            name: 'Markdown Table',
            cellData: cellData,
            rowCount: Math.max(rows.length + 10, 30),
            columnCount: Math.max(headers.length + 10, 20),
            defaultColumnWidth: 120,
            defaultRowHeight: 24,
          }
        }
      });

      setMarkdownOutput(matrixToMarkdown(headers, rows));

      // Attach auto-sync listener after sheet is created
      attachSheetListener(univerAPI);
    });

    return () => {
      if (listenerDisposeRef.current) {
        listenerDisposeRef.current.dispose();
        listenerDisposeRef.current = null;
      }
      univerAPI.dispose();
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  /**
   * Parse markdown text → rebuild the Univer sheet.
   * Sets suppressSync to prevent the sheet listener from firing back.
   */
  const parseFromMarkdown = useCallback((md: string) => {
    setMarkdownOutput(md);

    const { headers: newHeaders, rows: newRows } = parseMarkdownToMatrix(md);

    const api = univerRef.current;
    if (!api) return;

    const wb = api.getActiveWorkbook();
    if (!wb) return;

    // Suppress sheet→markdown sync while we programmatically rebuild
    suppressSyncRef.current = true;

    // Normalize column widths
    const maxCols = Math.max(newHeaders.length, ...newRows.map((r: string[]) => r.length));
    const paddedHeaders = [...newHeaders];
    while (paddedHeaders.length < maxCols) paddedHeaders.push('');
    const paddedRows = newRows.map((r: string[]) => {
      const newRow = [...r];
      while (newRow.length < maxCols) newRow.push('');
      return newRow;
    });

    const values = [paddedHeaders, ...paddedRows];
    const cellData = buildCellData(values);

    // Dispose old workbook and create fresh one
    api.disposeUnit(wb.getId());

    api.createUniverSheet({
      id: 'sheet-' + Date.now(),
      name: 'Markdown Table',
      sheets: {
        'sheet-1': {
          id: 'sheet-1',
          name: 'Markdown Table',
          cellData: cellData,
          rowCount: Math.max(values.length + 10, 30),
          columnCount: Math.max(values[0].length + 10, 20),
          defaultColumnWidth: 120,
          defaultRowHeight: 24,
        }
      }
    });

    // Re-attach listener to the new workbook
    attachSheetListener(api);

    // Persist
    set(STORAGE_KEY, { headers: newHeaders, rows: newRows });

    // Re-enable sync after a short delay to let commands settle
    setTimeout(() => {
      suppressSyncRef.current = false;
    }, 200);
  }, [attachSheetListener]);

  const copyToClipboard = useCallback(() => {
    navigator.clipboard.writeText(markdownOutput);
  }, [markdownOutput]);

  const prettifyMarkdown = useCallback(() => {
    const { headers, rows } = parseMarkdownToMatrix(markdownOutput);
    const md = matrixToMarkdown(headers, rows);
    parseFromMarkdown(md);
  }, [markdownOutput, parseFromMarkdown]);

  return (
    <div className="flex flex-col md:flex-row gap-6 p-6 h-screen bg-gray-50 dark:bg-gray-950 text-gray-900 dark:text-gray-100 font-sans">
      
      {/* Markdown Editor Section */}
      <div className="w-full md:w-[400px] flex flex-col gap-4 min-h-0">
         <div className="flex items-center justify-between flex-shrink-0">
           <h2 className="text-lg font-semibold tracking-tight text-gray-800 dark:text-gray-200">Markdown Output</h2>
           <div className="flex gap-2">
             <button
               onClick={prettifyMarkdown}
               className="flex items-center gap-2 px-3 py-1.5 bg-gray-200 hover:bg-gray-300 dark:bg-gray-800 dark:hover:bg-gray-700 font-medium rounded-lg text-sm shadow-sm transition-colors"
               title="Prettify Markdown"
             >
                <Wand2 size={16} />
             </button>
             <button
               onClick={copyToClipboard}
               className="flex items-center gap-2 px-3 py-1.5 bg-gray-200 hover:bg-gray-300 dark:bg-gray-800 dark:hover:bg-gray-700 font-medium rounded-lg text-sm shadow-sm transition-colors"
             >
                <Copy size={16} />
             </button>
           </div>
         </div>
         
         <textarea
           value={markdownOutput}
           onChange={(e) => parseFromMarkdown(e.target.value)}
           className="flex-1 w-full p-5 font-mono text-sm leading-relaxed bg-white dark:bg-gray-900 rounded-2xl shadow-xl border border-gray-200/50 dark:border-gray-800 outline-none focus:ring-2 focus:ring-emerald-500/50 focus:border-emerald-500/50 resize-none whitespace-pre transition-all min-h-0"
           placeholder="Paste Markdown table here..."
         />
      </div>

      {/* Spreadsheet Section */}
      <div className="flex-1 flex flex-col gap-4 min-h-0 overflow-hidden">
        <div className="flex items-center justify-between flex-shrink-0">
          <h1 className="text-lg font-semibold tracking-tight text-gray-800 dark:text-gray-200">MDS - Markdown Table Spreadsheet</h1>
          <div className="flex gap-3">
             <button onClick={() => {
                 const example = `| Feature | Basic | Pro | Enterprise |\n|---|---|---|---|\n| Users | 1 | 10 | Unlimited |\n| Storage | 5GB | 100GB | 2TB |\n| Support | Email | Priority | 24/7 Dedicated |\n| API Access | ❌ | ✅ | ✅ |\n| Custom Domain | ❌ | ✅ | ✅ |`;
                 parseFromMarkdown(example);
             }} className="flex items-center gap-2 px-4 py-2 bg-gray-200 hover:bg-gray-300 dark:bg-gray-800 dark:hover:bg-gray-700 text-gray-800 dark:text-gray-200 font-medium rounded-lg shadow-sm transition-colors text-sm">
               Load Example
             </button>
             <button onClick={() => {
                 parseFromMarkdown(`| Column 1 | Column 2 |\n|---|---|\n| | |`);
             }} className="flex items-center gap-2 px-4 py-2 bg-gray-200 hover:bg-gray-300 dark:bg-gray-800 dark:hover:bg-gray-700 text-gray-800 dark:text-gray-200 font-medium rounded-lg shadow-sm transition-colors text-sm">
               Clear
             </button>
          </div>
        </div>

        {/* Univer Container - needs a concrete height for canvas rendering */}
        <div className="flex-1 overflow-hidden bg-white rounded-2xl shadow-xl border border-gray-200/50 min-h-0 relative">
          <div ref={containerRef} className="univer-container" style={{ width: '100%', height: '100%', position: 'absolute', top: 0, left: 0 }} />
        </div>
      </div>

    </div>
  );
}
