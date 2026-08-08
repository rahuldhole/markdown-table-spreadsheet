"use client";

import dynamic from 'next/dynamic';

const TableEditor = dynamic(() => import('./table-editor'), { ssr: false });

export default function ClientWrapper() {
  return <TableEditor />;
}
