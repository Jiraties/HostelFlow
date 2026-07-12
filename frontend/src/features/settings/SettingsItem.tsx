import ActionButton from "../../components/ActionButton";

const SettingsItem = ({
  label,
  buttonLabel,
  action,
  icon,
  buttonClassName,
}: {
  label: string;
  buttonLabel: string;
  action: () => void | Promise<unknown>;
  icon: string;
  buttonClassName: string;
}) => {
  return (
    <div className="settings__item">
      <p>{label}</p>
      <ActionButton
        text={buttonLabel}
        icon={icon}
        onClick={action}
        className={buttonClassName}
      />
    </div>
  );
};

export default SettingsItem;
