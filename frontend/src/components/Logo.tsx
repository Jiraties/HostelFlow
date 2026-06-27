import "./Logo.css";

type LogoProps = {
  isAbsolute: boolean;
  extraText?: string;
};

const Logo = ({ isAbsolute = false, extraText = "" }: LogoProps) => {
  return (
    <div className={isAbsolute ? "logo__div absolute" : "logo__div"}>
      <h2 className="logo__blueText">Baan Mai Kradan</h2>
      <h2>{extraText}HostelFlow</h2>
    </div>
  );
};

export default Logo;
