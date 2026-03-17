"use client"

import { useState, useEffect, useRef, useCallback } from 'react';
import { FileText, Trash2, Download, Zap, Clock, CheckCircle, XCircle, Loader2, Terminal, StopCircle, Eye } from 'lucide-react';
import { TablePreview } from '@/components/TablePreview';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '@/components/ui/dialog';
import { useToast } from '@/hooks/use-toast';

interface Document {
  id: string;
  filename: string;
  blob_url: string;
  status: string;
  uploaded_at: string;
  extracted_at?: string;
}

interface DocumentListProps {
  documents: Document[];
  onRefresh: () => void;
}

interface LogEntry { time: string; message: string; kind: 'log' | 'error' | 'done' | 'aborted' }

function StatusBadge({ status }: { status: string }) {
  const map: Record<string, { cls: string; icon: React.ReactNode }> = {
    uploaded:   { cls: 'bg-gray-100 text-gray-700',    icon: <Clock className="h-3 w-3" /> },
    extracting: { cls: 'bg-yellow-100 text-yellow-800', icon: <Loader2 className="h-3 w-3 animate-spin" /> },
    extracted:  { cls: 'bg-green-100 text-green-800',   icon: <CheckCircle className="h-3 w-3" /> },
    failed:     { cls: 'bg-red-100 text-red-700',       icon: <XCircle className="h-3 w-3" /> },
  };
  const { cls, icon } = map[status] || map.uploaded;
  return (
    <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium ${cls}`}>
      {icon} {status}
    </span>
  );
}

const ts = () => new Date().toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', second: '2-digit' });

export function DocumentList({ documents, onRefresh }: DocumentListProps) {
  const [extractModal, setExtractModal] = useState<Document | null>(null);

  // logs[docId] = array of entries — persists across open/close
  const [logs, setLogs] = useState<Record<string, LogEntry[]>>({});
  const [previewDoc, setPreviewDoc] = useState<Document | null>(null);
  // which doc's log panel is currently visible
  const [visibleLog, setVisibleLog] = useState<string | null>(null);
  // which docs are actively streaming
  const [extractingIds, setExtractingIds] = useState<Set<string>>(new Set());
  // abort controllers keyed by docId
  const abortControllers = useRef<Record<string, AbortController>>({});
  const logEndRef = useRef<HTMLDivElement>(null);
  const { toast } = useToast();

  useEffect(() => {
    logEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [logs, visibleLog]);

  const appendLog = useCallback((docId: string, entry: LogEntry) => {
    setLogs(prev => ({ ...prev, [docId]: [...(prev[docId] ?? []), entry] }));
  }, []);

  const handleExtract = async () => {
    if (!extractModal) return;
    const doc = extractModal;
    setExtractModal(null);

    const controller = new AbortController();
    abortControllers.current[doc.id] = controller;

    // Reset log for this doc and show panel
    setLogs(prev => ({ ...prev, [doc.id]: [{ time: ts(), message: `Starting extraction for ${doc.filename}...`, kind: 'log' }] }));
    setVisibleLog(doc.id);
    setExtractingIds(prev => new Set(prev).add(doc.id));

    try {
      const res = await fetch(`/api/documents/${doc.id}/extract`, {
        method: 'POST',
        signal: controller.signal,
      });

      if (!res.body) throw new Error('No stream in response');

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() ?? '';

        for (const line of lines) {
          if (!line.startsWith('data: ')) continue;
          try {
            const event = JSON.parse(line.slice(6));

            if (event.type === 'log') {
              appendLog(doc.id, { time: ts(), message: event.message, kind: 'log' });
            } else if (event.type === 'done') {
              appendLog(doc.id, { time: ts(), message: `✅ Done — ${event.inserted} new transactions imported · ${event.skipped} duplicates skipped`, kind: 'done' });
              toast({ title: 'Extraction complete', description: `✓ ${event.inserted} new · ⊘ ${event.skipped} duplicates` });
              setExtractingIds(prev => { const s = new Set(prev); s.delete(doc.id); return s; });
              delete abortControllers.current[doc.id];
              onRefresh();
            } else if (event.type === 'aborted') {
              appendLog(doc.id, { time: ts(), message: '🛑 Extraction terminated by user.', kind: 'aborted' });
              setExtractingIds(prev => { const s = new Set(prev); s.delete(doc.id); return s; });
              delete abortControllers.current[doc.id];
              onRefresh();
            } else if (event.type === 'error') {
              appendLog(doc.id, { time: ts(), message: `❌ Error: ${event.message}`, kind: 'error' });
              toast({ title: 'Extraction failed', description: event.message, variant: 'destructive' });
              setExtractingIds(prev => { const s = new Set(prev); s.delete(doc.id); return s; });
              delete abortControllers.current[doc.id];
              onRefresh();
            }
          } catch { /* skip malformed lines */ }
        }
      }
    } catch (error) {
      const aborted = controller.signal.aborted;
      if (!aborted) {
        const msg = error instanceof Error ? error.message : 'Unknown error';
        appendLog(doc.id, { time: ts(), message: `❌ ${msg}`, kind: 'error' });
        toast({ title: 'Extraction failed', description: msg, variant: 'destructive' });
      }
      setExtractingIds(prev => { const s = new Set(prev); s.delete(doc.id); return s; });
      delete abortControllers.current[doc.id];
      onRefresh();
    }
  };

  const handleTerminate = (docId: string) => {
    const controller = abortControllers.current[docId];
    if (controller) {
      controller.abort();
      appendLog(docId, { time: ts(), message: '🛑 Termination requested — stopping after current operation...', kind: 'aborted' });
      setExtractingIds(prev => { const s = new Set(prev); s.delete(docId); return s; });
      delete abortControllers.current[docId];
      onRefresh();
    }
  };

  const handleDelete = async (doc: Document) => {
    if (!confirm(`Delete "${doc.filename}"? This will also delete all extracted transactions.`)) return;
    try {
      const res = await fetch(`/api/documents?id=${doc.id}`, { method: 'DELETE' });
      if (!res.ok) throw new Error('Delete failed');
      toast({ title: 'Document deleted' });
      setLogs(prev => { const n = { ...prev }; delete n[doc.id]; return n; });
      if (visibleLog === doc.id) setVisibleLog(null);
      onRefresh();
    } catch {
      toast({ title: 'Delete failed', variant: 'destructive' });
    }
  };

  if (documents.length === 0) {
    return (
      <div className="text-center py-12 text-muted-foreground">
        <FileText className="h-12 w-12 mx-auto mb-4 opacity-30" />
        <p>No documents uploaded yet. Upload your first bank statement above.</p>
      </div>
    );
  }

  const activeLogEntries = visibleLog ? (logs[visibleLog] ?? []) : [];
  const isActiveRunning = visibleLog ? extractingIds.has(visibleLog) : false;

  return (
    <>
      <div className="rounded-md border">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b bg-muted/50">
              <th className="text-left p-4 font-medium">Filename</th>
              <th className="text-left p-4 font-medium">Uploaded</th>
              <th className="text-left p-4 font-medium">Status</th>
              <th className="text-left p-4 font-medium">LLM</th>
              <th className="text-right p-4 font-medium">Actions</th>
            </tr>
          </thead>
          <tbody>
            {documents.map((doc) => {
              const isExtracting = extractingIds.has(doc.id);
              const hasLog = !!logs[doc.id]?.length;
              const isShowingLog = visibleLog === doc.id;

              return (
                <tr key={doc.id} className={`border-b last:border-0 hover:bg-muted/30 ${isShowingLog ? 'bg-blue-50/40' : ''}`}>
                  <td className="p-4">
                    <div className="flex items-center gap-2">
                      <FileText className="h-4 w-4 text-blue-500 flex-shrink-0" />
                      <span className="font-medium truncate max-w-xs">{doc.filename}</span>
                    </div>
                  </td>
                  <td className="p-4 text-muted-foreground">
                    {new Date(doc.uploaded_at).toLocaleDateString()}
                  </td>
                  <td className="p-4">
                    <StatusBadge status={isExtracting ? 'extracting' : doc.status} />
                  </td>
                  <td className="p-4">
                    <div className="flex items-center justify-end gap-1">
                      {/* Log toggle — shown if there's any log for this doc */}
                      {hasLog && (
                        <Button
                          size="sm" variant="ghost"
                          onClick={() => setVisibleLog(isShowingLog ? null : doc.id)}
                          title={isShowingLog ? 'Hide log' : 'Show extraction log'}
                          className={isShowingLog ? 'text-blue-600' : 'text-muted-foreground'}
                        >
                          <Terminal className="h-4 w-4" />
                        </Button>
                      )}

                      {/* Preview table */}
                      <Button
                        size="sm" variant="ghost"
                        onClick={() => setPreviewDoc(doc)}
                        title="Preview extracted table"
                        className="text-muted-foreground hover:text-blue-600"
                      >
                        <Eye className="h-4 w-4" />
                      </Button>

                      {/* Terminate — only while extracting */}
                      {isExtracting && (
                        <Button
                          size="sm" variant="ghost"
                          className="text-red-500 hover:text-red-600"
                          onClick={() => handleTerminate(doc.id)}
                          title="Terminate extraction"
                        >
                          <StopCircle className="h-4 w-4" />
                        </Button>
                      )}

                      <Button
                        size="sm" variant="outline"
                        onClick={() => setExtractModal(doc)}
                        disabled={isExtracting}
                      >
                        {isExtracting
                          ? <><Loader2 className="h-4 w-4 animate-spin mr-1" />Extracting...</>
                          : <><Zap className="h-4 w-4 mr-1" />Extract</>}
                      </Button>

                      <Button size="sm" variant="ghost" asChild>
                        <a href={doc.blob_url} target="_blank" rel="noreferrer" title="Download PDF">
                          <Download className="h-4 w-4" />
                        </a>
                      </Button>

                      <Button
                        size="sm" variant="ghost"
                        className="text-destructive hover:text-destructive"
                        onClick={() => handleDelete(doc)}
                        disabled={isExtracting}
                        title="Delete document"
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* Live / historical log panel */}
      {visibleLog && (
        <div className="rounded-lg border bg-gray-950 text-gray-100 text-xs font-mono overflow-hidden">
          <div className="flex items-center justify-between px-4 py-2 bg-gray-900 border-b border-gray-800">
            <div className="flex items-center gap-2 text-gray-400">
              <Terminal className="h-3.5 w-3.5" />
              <span>
                {documents.find(d => d.id === visibleLog)?.filename}
                {isActiveRunning && <span className="ml-2 text-yellow-400 animate-pulse">● live</span>}
              </span>
            </div>
            <div className="flex items-center gap-2">
              {isActiveRunning && (
                <button
                  onClick={() => handleTerminate(visibleLog)}
                  className="flex items-center gap-1 text-red-400 hover:text-red-300 text-xs px-2 py-0.5 border border-red-800 rounded"
                >
                  <StopCircle className="h-3 w-3" /> Terminate
                </button>
              )}
              <button onClick={() => setVisibleLog(null)} className="text-gray-500 hover:text-gray-300 text-lg leading-none px-1">×</button>
            </div>
          </div>
          <div className="p-4 space-y-1 max-h-72 overflow-y-auto">
            {activeLogEntries.map((entry, i) => (
              <div key={i} className={`flex gap-3 ${
                entry.kind === 'error'   ? 'text-red-400' :
                entry.kind === 'done'    ? 'text-green-400' :
                entry.kind === 'aborted' ? 'text-yellow-400' : 'text-gray-300'
              }`}>
                <span className="text-gray-600 shrink-0">{entry.time}</span>
                <span>{entry.message}</span>
              </div>
            ))}
            {isActiveRunning && (
              <div className="flex gap-3 text-yellow-500 animate-pulse">
                <span className="text-gray-600 shrink-0">{ts()}</span>
                <span>⏳ Processing...</span>
              </div>
            )}
            <div ref={logEndRef} />
          </div>
        </div>
      )}

      {previewDoc && (
        <TablePreview
          documentId={previewDoc.id}
          filename={previewDoc.filename}
          open={!!previewDoc}
          onClose={() => setPreviewDoc(null)}
        />
      )}

      <Dialog open={!!extractModal} onOpenChange={() => setExtractModal(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Extract Transactions</DialogTitle>
            <DialogDescription>
              Extract all transactions from <strong>{extractModal?.filename}</strong> using coordinate-based PDF table parsing. No AI or network calls — fast and deterministic.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setExtractModal(null)}>Cancel</Button>
            <Button onClick={handleExtract}><Zap className="h-4 w-4 mr-2" />Run Extraction</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
