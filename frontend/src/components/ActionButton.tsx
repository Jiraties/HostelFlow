import "./ActionButton.css";

const ActionButton = ({
  text,
  icon,
  onClick,
  className = "",
  highlight = false,
  disabled = false,
  ariaLabel,
}: {
  text: string;
  icon: string;
  onClick: () => void;
  className?: string;
  highlight?: boolean;
  disabled?: boolean;
  ariaLabel?: string;
}) => {
  const isIconOnly = text.trim().length === 0;

  return (
    <button
      type="button"
      className={
        "home__action " +
        className +
        (isIconOnly ? " home__actionIconOnly" : "") +
        (highlight ? " home__actionHighlight" : "") +
        (disabled ? " home__actionDisabled" : "")
      }
      onClick={onClick}
      disabled={disabled}
      aria-label={isIconOnly ? ariaLabel || "ดำเนินการ" : undefined}
    >
      {!isIconOnly && <p>{text}</p>}
      <i className={`bx ${icon}`} />
    </button>
  );
};

export default ActionButton;
