import { useEffect, useId, useRef, useState } from "react";
import Modal from "./MotionModal";
import ConfirmationModal from "./ConfirmationModal";
import "./useAppConfirmation.css";

type ConfirmationOptions = {
  title: string;
  description?: string;
  confirmText: string;
  confirmIcon?: string;
  destructive?: boolean;
  reasonLabel?: string;
};

/** Resolves null on dismissal and the entered reason (or an empty string) on confirmation. */
export const useAppConfirmation = () => {
  const [options, setOptions] = useState<ConfirmationOptions | null>(null);
  const [sequence, setSequence] = useState(0);
  const pending = useRef<((result: string | null) => void) | null>(null);
  const id = useId();

  useEffect(() => () => {
    pending.current?.(null);
    pending.current = null;
  }, []);

  const ask = (next: ConfirmationOptions): Promise<string | null> => {
    if (pending.current) return Promise.resolve(null);
    setSequence((value) => value + 1);
    setOptions(next);
    return new Promise((resolve) => { pending.current = resolve; });
  };
  const finish = (result: string | null) => {
    const resolve = pending.current;
    pending.current = null;
    setOptions(null);
    resolve?.(result);
  };
  const dialog = (
    <Modal open={Boolean(options)} onClose={() => finish(null)} className="home__modalCenter" aria-labelledby={`${id}-title`} aria-describedby={options?.description ? `${id}-description` : undefined}>
      <ConfirmationModal
        key={sequence}
        variant="custom"
        dialogId={id}
        title={options?.title}
        description={options?.description}
        confirmText={options?.confirmText}
        confirmIcon={options?.confirmIcon}
        destructive={options?.destructive}
        reasonLabel={options?.reasonLabel}
        onClose={() => finish(null)}
        onConfirm={(reason) => finish(reason || "")}
      />
    </Modal>
  );
  return { ask, dialog };
};
