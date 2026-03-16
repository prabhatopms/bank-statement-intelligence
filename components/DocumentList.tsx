"use client"

import { useState, useEffect, useRef } from 'react';
import { FileText, Trash2, Download, Zap, Clock, CheckCircle, XCircle, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
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

interface ExtractionResult {
  inserted: number;
  skipped: number;
  total: number;
}

interface DocumentListProps {
  documents: Document[];
  onRefresh: () => void;
}

function StatusBadge({ status, elapsedSec }: { status: string; elapsedSec?: number }) {
  const map: Record<string, { cls: string; icon: React.ReactNode }> = {
    uploaded:   { cls: 'bg-gray-100 text-gray-700',   icon: <Clock className="h-3 w-3" /> },
    extracting: { cls: 'bg-yellow-100 text-yellow-800', icon: <Loader2 className="h-3 w-3 animate-spin" /> },
    extracted:  { cls: 'bg-green-100 text-green-800',  icon: <CheckCircle className="h-3 w-3" /> },
    failed:     { cls: 'bg-red-100 text-red-700',      icon: <XCircle className="h-3 w-3" /> },
  };
  const { cls, icon } = map[status] || map.uploaded;
  const timeStr = status === 'extracting' && elapsedSec ? ` ${elapsedSec}s` : '';
  return (
    <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium ${cls}`}>
      {icon}
      {status}{timeStr}
    </span>
  );
}

export function DocumentList({ documents, onRefresh }: DocumentListProps) {
  const [extracting, setExtracting] = useState<string | null>(null);
  const [extractModal, setExtractModal] = useState<Document | null>(null);
  const [llmProvider, setLlmProvider] = useState('openai');
  const [llmModel, setLlmModel] = useState('gpt-4o');
  const [elapsed, setElapsed] = useState<Record<string, number>>({});
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const { toast } = useToast();

  const extractingDocs = documents.filter(d => d.status === 'extracting');

  // Poll every 3s while any document is extracting
  useEffect(() => {
    if (extractingDocs.length > 0) {
      if (!pollRef.current) {
        pollRef.current = setInterval(() => { onRefresh(); }, 3000);
      }
      if (!timerRef.current) {
        timerRef.current = setInterval(() => {
          setElapsed(prev => {
            const next = { ...prev };
            extractingDocs.forEach(d => { next[d.id] = (next[d.id] || 0) + 1; });
            return next;
          });
        }, 1000);
      }
    } else {
      if (pollRef.current) { clearInterval(pollRef.current); pollRef.current = null; }
      if (timerRef.current) { clearInterval(timerRef.current); timerRef.current = null; }
    }
    return () => {
      if (pollRef.current) { clearInterval(pollRef.current); pollRef.current = null; }
      if (timerRef.current) { clearInterval(timerRef.current); timerRef.current = null; }
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [extractingDocs.length]);

  const handleExtract = async () => {
    if (!extractModal) return;
    const docId = extractModal.id;
    setExtracting(docId);
    setElapsed(prev => ({ ...prev, [docId]: 0 }));
    setExtractModal(null);

    try {
      const res = await fetch(`/api/documents/${docId}/extract`, { method: 'POST' });
      const data = await res.json();
      if (res.status === 401) throw new Error('Unauthorized');
      if (res.status === 404) throw new Error('Document not found');
      // 202 = started in background, UI will poll for completion
      toast({
        title: 'Extraction started',
        description: 'Running in background — the status will update automatically.',
      });
      onRefresh();
    } catch (error) {
      toast({
        title: 'Extraction failed',
        description: error instanceof Error ? error.message : 'Unknown error',
        variant: 'destructive',
      });
      setExtracting(null);
    }
  };

  const handleDelete = async (doc: Document) => {
    if (!confirm(`Delete "${doc.filename}"? This will also delete all extracted transactions.`)) return;

    try {
      const res = await fetch(`/api/documents?id=${doc.id}`, { method: 'DELETE' });
      if (!res.ok) throw new Error('Delete failed');
      toast({ title: 'Document deleted' });
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
            {documents.map((doc) => (
              <tr key={doc.id} className="border-b last:border-0 hover:bg-muted/30">
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
                  <StatusBadge status={doc.status} elapsedSec={elapsed[doc.id]} />
                </td>
                <td className="p-4 text-muted-foreground text-xs">
                  <span className="font-mono">{doc.llm_provider}/{doc.llm_model}</span>
                </td>
                <td className="p-4">
                  <div className="flex items-center justify-end gap-2">
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => {
                        setLlmProvider(doc.llm_provider || 'anthropic');
                        setLlmModel(doc.llm_model || 'claude-sonnet-4-20250514');
                        setExtractModal(doc);
                      }}
                      disabled={extracting === doc.id}
                    >
                      {extracting === doc.id ? (
                        <Loader2 className="h-4 w-4 animate-spin" />
                      ) : (
                        <Zap className="h-4 w-4" />
                      )}
                      <span className="ml-1">{extracting === doc.id ? 'Extracting...' : 'Extract'}</span>
                    </Button>
                    <Button size="sm" variant="ghost" asChild>
                      <a href={doc.blob_url} target="_blank" rel="noreferrer">
                        <Download className="h-4 w-4" />
                      </a>
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      className="text-destructive hover:text-destructive"
                      onClick={() => handleDelete(doc)}
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <Dialog open={!!extractModal} onOpenChange={() => setExtractModal(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Extract Transactions</DialogTitle>
            <DialogDescription>
              Configure the LLM to use for extracting transactions from {extractModal?.filename}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <Label>LLM Provider</Label>
              <Select value={llmProvider} onValueChange={setLlmProvider}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="anthropic">Anthropic (Claude)</SelectItem>
                  <SelectItem value="openai">OpenAI (GPT)</SelectItem>
                  <SelectItem value="google">Google (Gemini)</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>Model</Label>
              <Input
                value={llmModel}
                onChange={(e) => setLlmModel(e.target.value)}
                placeholder="e.g. claude-sonnet-4-20250514"
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setExtractModal(null)}>Cancel</Button>
            <Button onClick={handleExtract}>
              <Zap className="h-4 w-4 mr-2" />
              Run Extraction
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
