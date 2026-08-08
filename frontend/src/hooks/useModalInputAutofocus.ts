import { useEffect } from "react";

const MODAL_FIELD_SELECTOR = [
  'input:not([type="hidden"]):not([type="button"]):not([type="submit"]):not([type="reset"]):not([type="checkbox"]):not([type="radio"]):not([type="file"]):not([disabled]):not([readonly]):not([aria-hidden="true"])',
  'textarea:not([disabled]):not([readonly]):not([aria-hidden="true"])',
  'select:not([disabled]):not([aria-hidden="true"])',
  '[contenteditable="true"]:not([aria-hidden="true"])',
].join(",");

const isVisibleField = (element: HTMLElement) =>
  element.tabIndex !== -1 && element.getClientRects().length > 0;

export const useModalInputAutofocus = () => {
  useEffect(() => {
    const focusedModals = new WeakSet<Element>();
    const scheduledModals = new WeakSet<Element>();

    const focusFirstField = (modal: Element) => {
      if (
        focusedModals.has(modal) ||
        scheduledModals.has(modal) ||
        modal.hasAttribute("data-disable-input-autofocus")
      ) {
        return;
      }

      scheduledModals.add(modal);
      window.requestAnimationFrame(() => {
        window.requestAnimationFrame(() => {
          scheduledModals.delete(modal);
          if (!modal.isConnected || focusedModals.has(modal)) return;

          const activeElement = document.activeElement;
          if (
            activeElement instanceof HTMLElement &&
            modal.contains(activeElement) &&
            activeElement.matches(MODAL_FIELD_SELECTOR)
          ) {
            focusedModals.add(modal);
            return;
          }

          const fields = Array.from(
            modal.querySelectorAll<HTMLElement>(MODAL_FIELD_SELECTOR),
          );
          const explicitField = fields.find(
            (field) => field.hasAttribute("autofocus") && isVisibleField(field),
          );
          const field = explicitField || fields.find(isVisibleField);
          if (!field) return;

          field.focus({ preventScroll: true });
          focusedModals.add(modal);
        });
      });
    };

    const inspectNode = (node: Node) => {
      if (!(node instanceof Element)) return;

      const modals = new Set<Element>();
      if (node.matches(".MuiModal-root")) modals.add(node);
      node.querySelectorAll(".MuiModal-root").forEach((modal) =>
        modals.add(modal),
      );
      const containingModal = node.closest(".MuiModal-root");
      if (containingModal) modals.add(containingModal);
      modals.forEach(focusFirstField);
    };

    document.querySelectorAll(".MuiModal-root").forEach(focusFirstField);
    const observer = new MutationObserver((mutations) => {
      mutations.forEach((mutation) =>
        mutation.addedNodes.forEach(inspectNode),
      );
    });
    observer.observe(document.body, { childList: true, subtree: true });

    return () => observer.disconnect();
  }, []);
};
