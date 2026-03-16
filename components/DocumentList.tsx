"use client"

import { useState } from 'react';
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

function StatusBadge({ status }: { status: string }) {
  const variants: Record<string, { variant: 'default' | 'secondary' | 'destructive' | 'outline' | 'success' | 'warning'; icon: React.ReactNode }> = {
    uploaded: { variant: 'secondary', icon: <Clock className="h-3 w-3" /> },
    extracting: { variant: 'warning', icon: <Loader2 className="h-3 w-3 animate-spin" /> },
    extracted: { variant: 'success', icon: <CheckCircle className="h-3 w-3" /> },
    failed: { variant: 'destructive', icon: <XCircle className="h-3 w-3" /> },
  };
  const { variant, icon } = variants[status] || variants.uploaded;
  return (
    <Badge variant={variant} className="flex items-center gap-1">
      {icon}
      {status}
    </Badge>
  );
}

export function DocumentList({ documents, onRefresh }: DocumentListProps) {
  const [extracting, setExtracting] = useState<string | null>(null);
  const [extractModal, setExtractModal] = useState<Document | null>(null);
  const [llmProvider, setLlmProvider] = useState('anthropic');
  const [llmModel, setLlmModel] = useState('claude-sonnet-4-20250514');
  const { toast } = useToast();

  const handleExtract = async () => {
    if (!extractModal) return;
    setExtracting(extractModal.id);
    setExtractModal(null);

    try {
      const res = await fetch(`/api/documents/${extractModal.id}/extract`, {
        method: 'POST',
      });
      const data: ExtractionResult & { error?: string } = await res.json();

      if (!res.ok) throw new Error(data.error || 'Extraction failed');

      toast({
        title: 'Extraction complete',
        description: `✓ ${data.inserted} new transactions · ⊘ ${data.skipped} duplicates skipped`,
      });
      onRefresh();
    } catch (error) {
      toast({
        title: 'Extraction failed',
        description: error instanceof Error ? error.message : 'Unknown error',
        variant: 'destructive',
      });
    } finally {
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
                  <StatusBadge status={doc.status} />
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
