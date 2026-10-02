import Home from "./pages/Home";
import Login from "./pages/Login";
import axios from "axios";
import { Toaster } from "react-hot-toast";
import { useEffect, useState } from "react";
import { Routes, Route } from "react-router";
import { useAuth } from "./context/AuthContext";
import { API_URL } from "./config/api";

import "./App.css";
import Sidebar from "./components/Sidebar";
import NotFound from "./pages/NotFound";
import Settings from "./pages/Settings";
import Calendar from "./pages/Calendar";
import Main from "./pages/Main";
import Documents from "./pages/Documents";
import Manage from "./pages/Manage";
import Analytics from "./pages/Analytics";
import { CommandPaletteProvider } from "./context/CommandPaletteContext";
import { useModalInputAutofocus } from "./hooks/useModalInputAutofocus";

function App() {
  const { isAuthenticated, login, user } = useAuth();
  const [checkingAuth, setCheckingAuth] = useState(true);
  useModalInputAutofocus();

  useEffect(() => {
    const fetchUser = async () => {
      try {
        const response = await axios.get(`${API_URL}/auth/me`, {
          withCredentials: true,
        });

        const user = response.data.user;

        if (response.data.user) {
          console.log(user);
          login(user);
          setCheckingAuth(false);
        }
      } catch (err) {
        console.error(err);
        setCheckingAuth(false);
      }
    };

    fetchUser();
  }, []);

  if (checkingAuth) return <></>;

  return (
    <div className="root">
      <Toaster
        position="top-center"
        toastOptions={{
          duration: 5000,
          success: {
            duration: 3000,
          },
          error: {
            duration: 7000,
          },
          style: {
            padding: "1rem",
            backgroundColor: "#fff",
            borderRadius: "1rem",
          },
        }}
      />
      {isAuthenticated ? (
        <div className="app">
          <CommandPaletteProvider>
            <Sidebar />
            <Routes>
              <Route path="/" element={<Main />} />
              <Route path="/analytics" element={<Analytics />} />
              {user?.admin && <Route path="/manage" element={<Manage />} />}
              <Route path="/arrivals" element={<Home status="arrivals" />} />
              <Route path="/departures" element={<Home status="departures" />} />
              <Route path="/master" element={<Home status="master" />} />
              <Route path="/calendar" element={<Calendar />} />
              <Route path="/settings" element={<Settings />} />
              <Route path="/documents" element={<Documents />} />
              <Route path="*" element={<NotFound />} />
            </Routes>
          </CommandPaletteProvider>
        </div>
      ) : (
        <Routes>
          <Route path="/" element={<Login />} />
          <Route path="*" element={<NotFound />} />
        </Routes>
      )}
    </div>
  );
}

export default App;
