import "./ModalCloseButton.css";

const ModalCloseButton = ({ onClick }: { onClick: () => void }) => {
  return (
    <button
      type="button"
      className="modalCloseButton"
      aria-label="Close modal"
      onClick={onClick}
    >
      <i className="bx bx-x" />
    </button>
  );
};

export default ModalCloseButton;
