import "./ActionButton.css";

const ActionButton = ({
  text,
  icon,
  onClick,
  className = "",
  highlight = false,
  disabled = false,
}: {
  text: string;
  icon: string;
  onClick: () => void;
  className?: string;
  highlight?: boolean;
  disabled?: boolean;
}) => {
  const isIconOnly = text.trim().length === 0;

  return (
    <div
      className={
        "home__action " +
        className +
        (isIconOnly ? " home__actionIconOnly" : "") +
        (highlight ? " home__actionHighlight" : "") +
        (disabled ? " home__actionDisabled" : "")
      }
      onClick={disabled ? () => {} : onClick}
    >
      {!isIconOnly && <p>{text}</p>}
      <i className={`bx ${icon}`} />
    </div>
  );
};

export default ActionButton;
