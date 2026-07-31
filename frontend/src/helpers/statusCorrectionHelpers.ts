export type StatusCorrectionType =
  | "UNDO_CHECKOUT"
  | "UNDO_CANCELLATION"
  | "UNDO_NO_SHOW";

export const statusCorrectionForStatus = (
  status: string,
): StatusCorrectionType | null => {
  if (status === "checkedOut") return "UNDO_CHECKOUT";
  if (status === "cancelled") return "UNDO_CANCELLATION";
  if (status === "noShow") return "UNDO_NO_SHOW";
  return null;
};

export const statusCorrectionActionLabel = (
  correctionType: StatusCorrectionType | null,
) => {
  if (correctionType === "UNDO_CHECKOUT") {
    return "Undo Checkout";
  }
  if (correctionType === "UNDO_CANCELLATION") {
    return "Undo Cancellation";
  }
  if (correctionType === "UNDO_NO_SHOW") {
    return "Undo No-Show";
  }
  return "";
};
