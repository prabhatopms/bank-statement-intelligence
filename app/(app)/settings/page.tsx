"use client"

import { useState } from 'react';
import { Key, Trash2, AlertTriangle, Settings, Eye, EyeOff } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

function MaskedInput({ label, envVar, placeholder }: { label: string; envVar: string; placeholder?: string }) {
  const [show, setShow] = useState(false);
  return (
    <div className="space-y-2">
      <Label>{label}</Label>
      <div className="flex gap-2">
        <div className="relative flex-1">
          <Input
            type={show ? 'text' : 'password'}
            placeholder={placeholder || `Set via ${envVar} env variable`}
            disabled
            className="pr-10"
          />
          <button
            type="button"
            className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground"
            onClick={() => setShow(!show)}
          >
            {show ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
          </button>
        </div>
      </div>
      <p className="text-xs text-muted-foreground">Set <code className="bg-muted px-1 rounded">{envVar}</code> in your environment variables</p>
    </div>
  );
}

export default function SettingsPage() {
  const [deleting, setDeleting] = useState(false);

  const handleDeleteAll = async () => {
    if (!confirm('Are you sure? This will permanently delete ALL your documents and transactions. This cannot be undone.')) return;
    if (!confirm('Final confirmation: Delete ALL data?')) return;

    setDeleting(true);
    try {
      const res = await fetch('/api/user/delete-all', { method: 'DELETE' });
      if (!res.ok) throw new Error('Failed to delete data');
      toast.success('All data deleted', { description: 'Your documents and transactions have been permanently deleted' });
    } catch {
      toast.error('Failed to delete data');
    } finally {
      setDeleting(false);
    }
  };

  return (
    <div className="space-y-8 max-w-2xl">
      <div>
        <h1 className="text-2xl font-bold flex items-center gap-2">
          <Settings className="h-6 w-6" />
          Settings
        </h1>
        <p className="text-muted-foreground mt-1">Configure API keys and application settings</p>
      </div>

      <div className="bg-white rounded-lg border p-6 space-y-6">
        <div className="flex items-center gap-2 mb-2">
          <Key className="h-5 w-5 text-blue-500" />
          <h2 className="text-lg font-semibold">LLM API Keys</h2>
        </div>
        <MaskedInput label="Anthropic API Key" envVar="ANTHROPIC_API_KEY" placeholder="sk-ant-..." />
        <MaskedInput label="OpenAI API Key" envVar="OPENAI_API_KEY" placeholder="sk-..." />
        <MaskedInput label="Google Generative AI API Key" envVar="GOOGLE_GENERATIVE_AI_API_KEY" placeholder="AIza..." />
      </div>

      <div className="bg-white rounded-lg border p-6 space-y-4">
        <h2 className="text-lg font-semibold">Enrichment</h2>
        <MaskedInput label="SerpAPI Key" envVar="SERPAPI_KEY" placeholder="For web-based merchant lookup" />
      </div>

      <div className="bg-white rounded-lg border p-6 space-y-4">
        <h2 className="text-lg font-semibold">Security</h2>
        <div className="space-y-2">
          <Label>Encryption Key</Label>
          <p className="text-sm text-muted-foreground">
            Set a 32-byte hex string as <code className="bg-muted px-1 rounded">ENCRYPTION_KEY</code> environment variable.
            Generate with: <code className="bg-muted px-1 rounded">openssl rand -hex 32</code>
          </p>
          <p className="text-xs text-amber-600 bg-amber-50 border border-amber-200 rounded p-2">
            Warning: Never change this key after uploading documents with passwords - it will make encrypted passwords unreadable.
          </p>
        </div>
      </div>

      <div className="bg-white rounded-lg border border-destructive/30 p-6 space-y-4">
        <div className="flex items-center gap-2">
          <AlertTriangle className="h-5 w-5 text-destructive" />
          <h2 className="text-lg font-semibold text-destructive">Danger Zone</h2>
        </div>
        <p className="text-sm text-muted-foreground">
          Permanently delete all your documents and transactions. This action cannot be undone.
        </p>
        <Button variant="destructive" onClick={handleDeleteAll} disabled={deleting}>
          <Trash2 className="h-4 w-4 mr-2" />
          {deleting ? 'Deleting...' : 'Delete All My Data'}
        </Button>
      </div>
    </div>
  );
}
