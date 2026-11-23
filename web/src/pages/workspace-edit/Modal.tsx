import { Dialog } from "radix-ui";
import type { ReactNode } from "react";

/** A flat, centred dialog: a title, a body, and the buttons in a row at the bottom. */
export function Modal({
  open,
  onOpenChange,
  title,
  description,
  wide,
  children,
  footer,
}: Readonly<{
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description?: string;
  wide?: boolean;
  children?: ReactNode;
  footer?: ReactNode;
}>) {
  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-50 bg-scrim data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:animate-in data-[state=open]:fade-in-0" />
        <Dialog.Content
          className={`fixed left-1/2 top-1/2 z-50 flex max-h-[88dvh] w-[calc(100vw-2rem)] -translate-x-1/2 -translate-y-1/2 flex-col rounded-sheet bg-surface-1 outline-none ${wide ? "max-w-5xl" : "max-w-md"}`}
        >
          <div className="flex flex-col gap-1 px-5 pb-3 pt-5">
            <Dialog.Title className="m-0 text-[16px] font-semibold text-ink">{title}</Dialog.Title>
            {description ? (
              <Dialog.Description className="m-0 text-[13px] leading-5 text-ink-3">{description}</Dialog.Description>
            ) : (
              <Dialog.Description className="sr-only">{title}</Dialog.Description>
            )}
          </div>
          {children && <div className="min-h-0 flex-1 overflow-auto px-5">{children}</div>}
          {footer && <div className="flex flex-wrap items-center justify-end gap-2 px-5 py-4">{footer}</div>}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
