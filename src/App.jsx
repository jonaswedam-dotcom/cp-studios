import { Routes, Route, Navigate } from 'react-router-dom'
import { AppProvider, useApp } from './context/AppContext'
import { CasinoProvider } from './context/CasinoContext'
import Navbar from './components/Navbar'
import ChatBubble from './components/ChatBubble'
import LoginPage from './pages/LoginPage'
import HomePage from './pages/HomePage'
import AdminPage from './pages/AdminPage'
import CasinoPage from './pages/CasinoPage'
import CoinFlipGame from './pages/casino/CoinFlipGame'
import DiceGame from './pages/casino/DiceGame'
import RouletteGame from './pages/casino/RouletteGame'
import BlackjackGame from './pages/casino/BlackjackGame'
import SlotsGame from './pages/casino/SlotsGame'
import AviatorGame from './pages/casino/AviatorGame'
import ChickenRoadGame from './pages/casino/ChickenRoadGame'
import MinesGame from './pages/casino/MinesGame'
import PlinkoGame from './pages/casino/PlinkoGame'
import WarPage from './pages/WarPage'

function WithNav({ children }) {
  const { chatOpen } = useApp()
  return (
    <>
      <Navbar />
      <main
        className={`pt-16 min-h-screen bg-cp-bg transition-[padding] duration-300 ${
          chatOpen ? 'lg:pr-[300px]' : ''
        }`}
      >
        {children}
      </main>
    </>
  )
}

// Redirect to /login when not authenticated
function ProtectedRoute({ children }) {
  const { session, authLoading } = useApp()
  if (authLoading) return (
    <div className="min-h-screen bg-cp-bg flex items-center justify-center">
      <div className="w-6 h-6 border-2 border-cp-accent border-t-transparent rounded-full animate-spin" />
    </div>
  )
  if (!session) return <Navigate to="/login" replace />
  return children
}

// Admin-only gate
function AdminRoute({ children }) {
  const { session, authLoading, currentUser } = useApp()
  if (authLoading) return null
  if (!session) return <Navigate to="/login" replace />
  if (!currentUser?.isAdmin) return <Navigate to="/" replace />
  return children
}

function AppRoutes() {
  const { session } = useApp()
  return (
    <Routes>
      <Route
        path="/login"
        element={session ? <Navigate to="/" replace /> : <LoginPage />}
      />

      <Route path="/" element={
        <ProtectedRoute>
          <WithNav><HomePage /></WithNav>
        </ProtectedRoute>
      } />

      {/* ── Casino ── */}
      <Route path="/casino" element={
        <ProtectedRoute>
          <WithNav><CasinoPage /></WithNav>
        </ProtectedRoute>
      } />
      <Route path="/casino/coin-flip" element={
        <ProtectedRoute>
          <WithNav><CoinFlipGame /></WithNav>
        </ProtectedRoute>
      } />
      <Route path="/casino/dice" element={
        <ProtectedRoute>
          <WithNav><DiceGame /></WithNav>
        </ProtectedRoute>
      } />
      <Route path="/casino/roulette" element={
        <ProtectedRoute>
          <WithNav><RouletteGame /></WithNav>
        </ProtectedRoute>
      } />
      <Route path="/casino/blackjack" element={
        <ProtectedRoute>
          <WithNav><BlackjackGame /></WithNav>
        </ProtectedRoute>
      } />
      <Route path="/casino/slots" element={
        <ProtectedRoute>
          <WithNav><SlotsGame /></WithNav>
        </ProtectedRoute>
      } />
      <Route path="/casino/aviator" element={
        <ProtectedRoute>
          <WithNav><AviatorGame /></WithNav>
        </ProtectedRoute>
      } />
      <Route path="/casino/chicken-road" element={
        <ProtectedRoute>
          <WithNav><ChickenRoadGame /></WithNav>
        </ProtectedRoute>
      } />
      <Route path="/casino/mines" element={
        <ProtectedRoute>
          <WithNav><MinesGame /></WithNav>
        </ProtectedRoute>
      } />
      <Route path="/casino/plinko" element={
        <ProtectedRoute>
          <WithNav><PlinkoGame /></WithNav>
        </ProtectedRoute>
      } />

      <Route path="/war" element={
        <ProtectedRoute>
          <WithNav><WarPage /></WithNav>
        </ProtectedRoute>
      } />

      <Route path="/admin" element={
        <AdminRoute>
          <WithNav><AdminPage /></WithNav>
        </AdminRoute>
      } />

      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  )
}

// Gates the chat bubble so blocked accounts (CHAT_BLOCKED_EMAILS) never render it.
// A wrapper rather than an early return inside ChatBubble — ChatBubble has many
// hooks and can't conditionally bail before them without breaking the Rules of Hooks.
function ChatBubbleGate() {
  const { currentUser } = useApp()
  if (currentUser?.isChatBlocked) return null
  return <ChatBubble />
}

export default function App() {
  return (
    <AppProvider>
      <CasinoProvider>
        <div className="min-h-screen bg-cp-bg">
          <AppRoutes />
          {/* Floating chat bubble — always mounted so state persists across navigation */}
          <ChatBubbleGate />
        </div>
      </CasinoProvider>
    </AppProvider>
  )
}
