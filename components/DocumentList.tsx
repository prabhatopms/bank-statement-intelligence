"use client"

import { useState, useEffect, useRef } from 'react';
import { FileText, Trash2, Download, Zap, Clock, CheckCircle, XCircle, Loader2, Terminal } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { useToast } from '@/hooks/use-toast';

interface Document {
  id: string;
  filename: string;
  blob_url: string;
  llm_provider: string;
  llm_model: string;
  status: string;
  uploaded_at: string;
  extracted_at?: string;
}

interface DocumentListProps {
  documents: Document[];
  onRefresh: () => void;
}

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

interface LogEntry { time: string; message: string; type: 'log' | 'error' | 'done' }

export function DocumentList({ documents, onRefresh }: DocumentListProps) {
  const [extractModal, setExtractModal] = useState<Document | null>(null);
  const [llmProvider, setLlmProvider] = useState('openai');
  const [llmModel, setLlmModel] = useState('gpt-4o');
  const [activeLog, setActiveLog] = useState<{ docId: string; entries: LogEntry[] } | null>(null);
  const [extractingIds, setExtractingIds] = useState<Set<string>>(new Set());
  const logEndRef = useRef<HTMLDivElement>(null);
  const { toast } = useToast();

  // Auto-scroll log to bottom
  useEffect(() => {
    logEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [activeLog?.entries.length]);

  const now = () => new Date().toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', second: '2-digit' });

  const handleExtract = async () => {
    if (!extractModal) return;
    const doc = extractModal;
    setExtractModal(null);
    setExtractingIds(prev => new Set(prev).add(doc.id));
    setActiveLog({ docId: doc.id, entries: [{ time: now(), message: `Starting extraction for ${doc.filename}...`, type: 'log' }] });

    try {
      const res = await fetch(`/api/documents/${doc.id}/extract`, { method: 'POST' });

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
              setActiveLog(prev => prev ? {
                ...prev,
                entries: [...prev.entries, { time: now(), message: event.message, type: 'log' }]
              } : prev);
            } else if (event.type === 'done') {
              setActiveLog(prev => prev ? {
                ...prev,
                entries: [...prev.entries, {
                  time: now(),
                  message: `✅ Done — ${event.inserted} new transactions imported · ${event.skipped} duplicates skipped`,
                  type: 'done'
                }]
              } : prev);
              toast({ title: 'Extraction complete', description: `✓ ${event.inserted} new · ⊘ ${event.skipped} duplicates` });
              setExtractingIds(prev => { const s = new Set(prev); s.delete(doc.id); return s; });
              onRefresh();
            } else if (event.type === 'error') {
              setActiveLog(prev => prev ? {
                ...prev,
                entries: [...prev.entries, { time: now(), message: `❌ Error: ${event.message}`, type: 'error' }]
              } : prev);
              toast({ title: 'Extraction failed', description: event.message, variant: 'destructive' });
              setExtractingIds(prev => { const s = new Set(prev); s.delete(doc.id); return s; });
              onRefresh();
            }
          } catch { /* skip malformed SSE lines */ }
        }
      }
    } catch (error) {
      const msg = error instanceof Error ? error.message : 'Unknown error';
      setActiveLog(prev => prev ? {
        ...prev,
        entries: [...prev.entries, { time: now(), message: `❌ ${msg}`, type: 'error' }]
      } : prev);
      toast({ title: 'Extraction failed', description: msg, variant: 'destructive' });
      setExtractingIds(prev => { const s = new Set(prev); s.delete(doc.id); return s; });
      onRefresh();
    }
  };

  const handleDelete = async (doc: Document) => {
    if (!confirm(`Delete "${doc.filename}"? This will also delete all extracted transactions.`)) return;
    try {
      const res = await fetch(`/api/documents?id=${doc.id}`, { method: 'DELETE' });
      if (!res.ok) throw new Error('Delete failed');
      toast({ title: 'Document deleted' });
      if (activeLog?.docId === doc.id) setActiveLog(null);
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
              const isExtracting = extractingIds.has(doc.id) || doc.status === 'extracting';
              const isActive = activeLog?.docId === doc.id;
              return (
                <tr key={doc.id} className={`border-b last:border-0 hover:bg-muted/30 ${isActive ? 'bg-blue-50/40' : ''}`}>
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
                  <td className="p-4 text-muted-foreground text-xs font-mono">
                    {doc.llm_provider}/{doc.llm_model}
                  </td>
                  <td className="p-4">
                    <div className="flex items-center justify-end gap-2">
                      {isActive && activeLog && (
                        <Button size="sm" variant="ghost" onClick={() => setActiveLog(null)} title="Hide log">
                          <Terminal className="h-4 w-4 text-blue-500" />
                        </Button>
                      )}
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => {
                          setLlmProvider(doc.llm_provider || 'openai');
                          setLlmModel(doc.llm_model || 'gpt-4o');
                          setExtractModal(doc);
                        }}
                        disabled={isExtracting}
                      >
                        {isExtracting
                          ? <><Loader2 className="h-4 w-4 animate-spin mr-1" /> Extracting...</>
                          : <><Zap className="h-4 w-4 mr-1" /> Extract</>
                        }
                      </Button>
                      <Button size="sm" variant="ghost" asChild>
                        <a href={doc.blob_url} target="_blank" rel="noreferrer">
                          <Download className="h-4 w-4" />
                        </a>
                      </Button>
                      <Button
                        size="sm" variant="ghost"
                        className="text-destructive hover:text-destructive"
                        onClick={() => handleDelete(doc)}
                        disabled={isExtracting}
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

      {/* Live extraction log */}
      {activeLog && (
        <div className="rounded-lg border bg-gray-950 text-gray-100 text-xs font-mono overflow-hidden">
          <div className="flex items-center justify-between px-4 py-2 bg-gray-900 border-b border-gray-800">
            <div className="flex items-center gap-2 text-gray-400">
              <Terminal className="h-3.5 w-3.5" />
              <span>Extraction log — {documents.find(d => d.id === activeLog.docId)?.filename}</span>
            </div>
            <button onClick={() => setActiveLog(null)} className="text-gray-500 hover:text-gray-300 text-lg leading-none">×</button>
          </div>
          <div className="p-4 space-y-1 max-h-72 overflow-y-auto">
            {activeLog.entries.map((entry, i) => (
              <div key={i} className={`flex gap-3 ${entry.type === 'error' ? 'text-red-400' : entry.type === 'done' ? 'text-green-400' : 'text-gray-300'}`}>
                <span className="text-gray-600 shrink-0">{entry.time}</span>
                <span>{entry.message}</span>
              </div>
            ))}
            {extractingIds.has(activeLog.docId) && (
              <div className="flex gap-3 text-yellow-400 animate-pulse">
                <span className="text-gray-600 shrink-0">{now()}</span>
                <span>⏳ Processing...</span>
              </div>
            )}
            <div ref={logEndRef} />
          </div>
        </div>
      )}

      <Dialog open={!!extractModal} onOpenChange={() => setExtractModal(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Extract Transactions</DialogTitle>
            <DialogDescription>
              Configure the LLM for extracting transactions from {extractModal?.filename}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <Label>LLM Provider</Label>
              <Select value={llmProvider} onValueChange={setLlmProvider}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="openai">OpenAI (GPT)</SelectItem>
                  <SelectItem value="anthropic">Anthropic (Claude)</SelectItem>
                  <SelectItem value="google">Google (Gemini)</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>Model</Label>
              <Input value={llmModel} onChange={(e) => setLlmModel(e.target.value)} placeholder="e.g. gpt-4o" />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setExtractModal(null)}>Cancel</Button>
            <Button onClick={handleExtract}>
              <Zap className="h-4 w-4 mr-2" /> Run Extraction
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
