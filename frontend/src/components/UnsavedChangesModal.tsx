import ConfirmationModal from "./ConfirmationModal";

const UnsavedChangesModal = ({
  onClose,
  onDiscard,
}: {
  onClose: () => void;
  onDiscard: () => void;
}) => (
  <ConfirmationModal
    variant="discardChanges"
    onClose={onClose}
    onConfirm={onDiscard}
  />
);

export default UnsavedChangesModal;
