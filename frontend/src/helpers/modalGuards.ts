export const requestUnsavedModalClose = (
  isDirty: boolean,
  closeModal: () => void,
  openConfirmation: () => void,
) => {
  if (!isDirty) {
    closeModal();
    return;
  }

  openConfirmation();
};
