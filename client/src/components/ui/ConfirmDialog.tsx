import { useState } from 'react';
import { Button } from './Button';
import { Modal } from './Modal';

export function ConfirmDialog({
  open,
  onOpenChange,
  title,
  description,
  confirmLabel = 'Confirm',
  tone = 'danger',
  onConfirm,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description: React.ReactNode;
  confirmLabel?: string;
  tone?: 'danger' | 'primary';
  onConfirm: () => Promise<void> | void;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  return (
    <Modal
      open={open}
      onOpenChange={(value) => {
        if (!busy) {
          setError(null);
          onOpenChange(value);
        }
      }}
      title={title}
      description={typeof description === 'string' ? description : undefined}
      size="sm"
      footer={
        <>
          <Button variant="secondary" onClick={() => onOpenChange(false)} disabled={busy}>
            Cancel
          </Button>
          <Button
            variant={tone === 'danger' ? 'danger' : 'primary'}
            loading={busy}
            onClick={async () => {
              setBusy(true);
              setError(null);
              try {
                await onConfirm();
                onOpenChange(false);
              } catch (caught) {
                setError(caught instanceof Error ? caught.message : 'The action failed.');
              } finally {
                setBusy(false);
              }
            }}
          >
            {confirmLabel}
          </Button>
        </>
      }
    >
      {typeof description !== 'string' ? (
        <div className="text-sm text-zinc-600">{description}</div>
      ) : null}
      {error ? <p className="mt-3 text-sm font-medium text-red-600">{error}</p> : null}
    </Modal>
  );
}
