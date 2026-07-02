import Logo from "../components/Logo";

import { useAuth } from "../context/AuthContext";
import { useState } from "react";
import { API_URL } from "../config/api";
import axios from "axios";
import usePageTitle from "../hooks/useTitle";

import "./Login.css";

const Login = () => {
  usePageTitle("HostelFlow · เข้าสู่ระบบ");
  const { login } = useAuth();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState({ code: 0, message: "" });
  const [shake, setShake] = useState(false);

  const triggerShake = () => {
    setShake(true);
    setTimeout(() => setShake(false), 350);
  };

  const submitLoginHandler = async (
    event: React.SubmitEvent<HTMLFormElement>,
  ) => {
    event.preventDefault();

    if (isLoading) return;
    setIsLoading(true);

    try {
      const response = await axios.post(
        `${API_URL}/auth/login`,
        {
          username: username,
          password,
        },
        { withCredentials: true },
      );

      login(response.data.user);
      console.log(response.data.user);

      setIsLoading(false);
    } catch (err: any) {
      setError({ code: err.response.status, message: err.response.data.error });
      setIsLoading(false);
      triggerShake();
    }
  };

  return (
    <div className="login__page">
      <div className="login__left">
        <Logo isAbsolute />

        <div className="center">
          <form className="login__form" onSubmit={submitLoginHandler}>
            <h1>เข้าสู่ระบบ</h1>
            {error.code !== 0 && (
              <div className={shake ? "login__error shake" : "login__error"}>
                <i className="bx bx-error"></i>
                <p>{error.message}</p>
              </div>
            )}
            <div className="login__formItem">
              <p className="login__formItemHeader">ชื่อผู้ใช้ </p>
              <input
                className="boxInput"
                value={username}
                onChange={(event) => setUsername(event.target.value)}
                type="text"
                placeholder="พิมพ์ชื่อผู้ใช้"
              />
            </div>
            <div className="login__formItem margBottom1">
              <p className="login__formItemHeader">รหัสผ่าน</p>
              <input
                className="boxInput"
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                type="password"
                placeholder="พิมพ์รหัสผ่าน"
              />
            </div>
            <button
              className={isLoading ? "boxButton loadingButton" : "boxButton"}
              type="submit"
            >
              <p>เข้าสู่ระบบ</p>
            </button>
          </form>
        </div>
      </div>
      <div className="login__right">
        <img
          src="https://images.trvl-media.com/lodging/22000000/21090000/21081500/21081429/dab60003.jpg?impolicy=resizecrop&rw=575&rh=575&ra=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"
          alt=""
          className="login__image login__image1"
        />
        <img
          src="https://cf.bstatic.com/xdata/images/hotel/max1024x768/490878870.jpg?k=8fad66bd2bca8d03750773ed11f37752e8a536f81b44f8e430026a1aca15df15&o="
          alt=""
          className="login__image"
        />
        <img
          src="https://cdn5.travelconline.com/images/fit-in/2000x0/filters:quality(75):strip_metadata():format(webp)/https%3A%2F%2Fq-xx.bstatic.com%2Fxdata%2Fimages%2Fhotel%2Fmax2000%2F492161945.jpg%3Fk%3D3a55811b3b428eb5e74102d78409cba1fd221f8bc58c2adc7780e1fcb69f21f7%26o%3D%26a%3D1955537"
          alt=""
          className="login__image"
        />
      </div>
    </div>
  );
};

export default Login;
