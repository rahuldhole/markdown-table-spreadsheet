import { remark } from 'remark';
import remarkGfm from 'remark-gfm';
import { markdownTable } from 'markdown-table';

// Helper to extract raw text from AST nodes
function extractText(node: any): string {
  if (node.type === 'text' || node.type === 'inlineCode') {
    return node.value || '';
  }
  if (node.children) {
    return node.children.map(extractText).join('');
  }
  return '';
}

export function parseMarkdownToMatrix(mdText: string): { headers: string[]; rows: string[][] } {
  try {
    const file = remark().use(remarkGfm).parse(mdText);
    
    let headers: string[] = [];
    let rows: string[][] = [];

    const tableNode = file.children.find((child: any) => child.type === 'table');

    if (tableNode && tableNode.type === 'table') {
      tableNode.children.forEach((rowNode: any, rowIndex: number) => {
        const rowData = rowNode.children.map((cellNode: any) => {
          return extractText(cellNode).trim();
        });

        if (rowIndex === 0) {
          headers = rowData;
        } else {
          rows.push(rowData);
        }
      });
    }

    if (headers.length === 0) {
      headers = ['Column 1', 'Column 2'];
      rows = [
        ['', '']
      ];
    }

    return { headers, rows };
  } catch (error) {
    console.error("Error parsing markdown", error);
    return {
      headers: ['Column 1', 'Column 2'],
      rows: [['', '']],
    };
  }
}

export function matrixToMarkdown(headers: string[], rows: string[][]): string {
  const tableData = [
    headers.map(h => h.replace(/\n/g, '<br>').replace(/\|/g, '\\|')),
    ...rows.map(row => row.map(cell => cell.replace(/\n/g, '<br>').replace(/\|/g, '\\|')))
  ];
  return markdownTable(tableData);
}
