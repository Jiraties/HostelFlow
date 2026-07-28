import "./ActionButton.css";

import type { MouseEvent } from "react";

const ActionButton = ({
  text,
  icon,
  onClick,
  className = "",
  highlight = false,
  disabled = false,
  tooltip,
  ariaLabel,
  mobileText,
}: {
  text: string;
  icon: string;
  tooltip?: string;
  mobileText?: string;
  onClick: (event: MouseEvent<HTMLButtonElement>) => void;
  className?: string;
  highlight?: boolean;
  disabled?: boolean;
  ariaLabel?: string;
}) => {
  const isIconOnly = text.trim().length === 0;

  return (
    <button
      type="button"
      title={tooltip || ""}
      className={
        "home__action " +
        className +
        (isIconOnly ? " home__actionIconOnly" : "") +
        (highlight ? " home__actionHighlight" : "") +
        (disabled ? " home__actionDisabled" : "")
      }
      onClick={onClick}
      disabled={disabled}
      aria-label={
        isIconOnly
          ? ariaLabel || mobileText || tooltip || "ดำเนินการ"
          : undefined
      }
    >
      {!isIconOnly && <p>{text}</p>}
      {mobileText && (
        <span className="home__actionMobileText">{mobileText}</span>
      )}
      <i className={`bx ${icon}`} />
    </button>
  );
};

export default ActionButton;
