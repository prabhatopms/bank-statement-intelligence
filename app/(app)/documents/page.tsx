"use client"

import { useState, useEffect, useRef } from 'react';
import { Upload, FileText, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { DocumentList } from '@/components/DocumentList';
import { Toaster } from '@/components/ui/toaster';
import { useToast } from '@/hooks/use-toast';

interface Document {
  id: string;
  filename: string;
  blob_url: string;
  status: string;
  uploaded_at: string;
  extracted_at?: string;
}

export default function DocumentsPage() {
  const [documents, setDocuments] = useState<Document[]>([]);
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [password, setPassword] = useState('');
  const fileInputRef = useRef<HTMLInputElement>(null);
  const { toast } = useToast();

  const fetchDocuments = async () => {
    try {
      const res = await fetch('/api/documents');
      const data = await res.json();
      setDocuments(data.documents || []);
    } catch {
      toast({ title: 'Failed to load documents', variant: 'destructive' });
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { fetchDocuments(); }, []);

  const handleUpload = async (e: React.FormEvent) => {
    e.preventDefault();
    const file = fileInputRef.current?.files?.[0];
    if (!file) return;

    setUploading(true);
    const formData = new FormData();
    formData.append('file', file);
    formData.append('password', password);

    try {
      const res = await fetch('/api/documents/upload', { method: 'POST', body: formData });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Upload failed');

      toast({ title: 'Document uploaded', description: `${file.name} uploaded successfully` });
      setPassword('');
      if (fileInputRef.current) fileInputRef.current.value = '';
      fetchDocuments();
    } catch (error) {
      toast({ title: 'Upload failed', description: error instanceof Error ? error.message : 'Unknown error', variant: 'destructive' });
    } finally {
      setUploading(false);
    }
  };

  return (
    <div className="space-y-8">
      <Toaster />
      <div>
        <h1 className="text-2xl font-bold">Documents</h1>
        <p className="text-muted-foreground mt-1">Upload bank statements — transactions are extracted automatically using coordinate-based PDF parsing</p>
      </div>

      <div className="bg-white rounded-lg border p-6">
        <h2 className="text-lg font-semibold mb-4 flex items-center gap-2">
          <Upload className="h-5 w-5 text-blue-500" />
          Upload Bank Statement
        </h2>
        <form onSubmit={handleUpload} className="space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="file">PDF File</Label>
              <Input id="file" type="file" accept=".pdf" ref={fileInputRef} required />
            </div>
            <div className="space-y-2">
              <Label htmlFor="password">PDF Password (optional)</Label>
              <Input
                id="password"
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="Leave empty if not password-protected"
              />
              <p className="text-xs text-muted-foreground">Stored encrypted (AES-256)</p>
            </div>
          </div>
          <Button type="submit" disabled={uploading}>
            {uploading ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <Upload className="h-4 w-4 mr-2" />}
            {uploading ? 'Uploading...' : 'Upload Document'}
          </Button>
        </form>
      </div>

      <div className="bg-white rounded-lg border p-6">
        <h2 className="text-lg font-semibold mb-4 flex items-center gap-2">
          <FileText className="h-5 w-5 text-blue-500" />
          Your Documents ({documents.length})
        </h2>
        {loading ? (
          <div className="flex items-center justify-center py-12">
            <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
          </div>
        ) : (
          <DocumentList documents={documents} onRefresh={fetchDocuments} />
        )}
      </div>
    </div>
  );
}
