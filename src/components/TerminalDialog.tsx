import { ui } from "../lib/ui";
import { useEffect, useId, useRef, type ReactNode } from "react";

export function TerminalDialog({
    title,
    onClose,
    children,
}: {
    title: string;
    onClose: () => void;
    children: ReactNode;
}) {
    const ref = useRef<HTMLDialogElement>(null);
    const titleId = useId();
    useEffect(() => {
        ref.current?.showModal();
    }, []);
    return (
        <dialog
            className="terminal-dialog"
            ref={ref}
            aria-labelledby={titleId}
            onCancel={(event) => {
                event.preventDefault();
                onClose();
            }}
        >
            <div className="terminal-dialog-header">
                <h2 className={ui.heading} id={titleId}>
                    {title}
                </h2>
                <button className={ui.button} type="button" onClick={onClose} aria-label="Закрыть окно">
                    ✕
                </button>
            </div>
            {children}
        </dialog>
    );
}
