import { Routes, Route, Navigate } from "react-router-dom";
import ProtectedRoute, { ROLE_HOME } from "./auth/ProtectedRoute";
import { session } from "./config/api";
import DashboardLayout from "./layout/DashboardLayout";
import Login from "./pages/Login";
import Overview from "./pages/Overview";
import Reservations from "./pages/Reservations";
import FloorMap from "./pages/FloorMap";
import Waitlist from "./pages/Waitlist";
import Orders from "./pages/Orders";
import Delivery from "./pages/Delivery";
import Pos from "./pages/Pos";
import Menu from "./pages/Menu";
import Diners from "./pages/Diners";
import Reviews from "./pages/Reviews";
import Chats from "./pages/Chats";
import Events from "./pages/Events";
import Settings from "./pages/Settings";
import Users from "./pages/Users";

function Home() {
  const { token, role } = session();
  if (!token) return <Navigate to="/login" replace />;
  return <Navigate to={ROLE_HOME[role] || "/overview"} replace />;
}

export default function App() {
  return (
    <Routes>
      <Route path="/login" element={<Login />} />
      <Route
        element={
          <ProtectedRoute>
            <DashboardLayout />
          </ProtectedRoute>
        }
      >
        <Route path="/overview" element={<ProtectedRoute roles={["manager"]}><Overview /></ProtectedRoute>} />
        <Route path="/reservations" element={<ProtectedRoute roles={["manager", "host"]}><Reservations /></ProtectedRoute>} />
        <Route path="/floor" element={<ProtectedRoute roles={["manager", "host"]}><FloorMap /></ProtectedRoute>} />
        <Route path="/waitlist" element={<ProtectedRoute roles={["manager", "host"]}><Waitlist /></ProtectedRoute>} />
        <Route path="/orders" element={<ProtectedRoute roles={["manager", "kitchen"]}><Orders /></ProtectedRoute>} />
        <Route path="/delivery" element={<ProtectedRoute roles={["manager", "kitchen"]}><Delivery /></ProtectedRoute>} />
        <Route path="/pos" element={<ProtectedRoute roles={["manager", "kitchen", "host"]}><Pos /></ProtectedRoute>} />
        <Route path="/menu" element={<ProtectedRoute roles={["manager", "kitchen"]}><Menu /></ProtectedRoute>} />
        <Route path="/diners" element={<ProtectedRoute roles={["manager", "host"]}><Diners /></ProtectedRoute>} />
        <Route path="/reviews" element={<ProtectedRoute roles={["manager", "host"]}><Reviews /></ProtectedRoute>} />
        <Route path="/chats" element={<ProtectedRoute roles={["manager", "host", "livechat"]}><Chats /></ProtectedRoute>} />
        <Route path="/events" element={<ProtectedRoute roles={["manager"]}><Events /></ProtectedRoute>} />
        <Route path="/settings" element={<ProtectedRoute roles={["manager"]}><Settings /></ProtectedRoute>} />
        <Route path="/users" element={<ProtectedRoute roles={["manager"]}><Users /></ProtectedRoute>} />
      </Route>
      <Route path="/" element={<Home />} />
      <Route path="*" element={<Home />} />
    </Routes>
  );
}
