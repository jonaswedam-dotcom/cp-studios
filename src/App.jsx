import { Routes, Route, Navigate } from 'react-router-dom'
import { AppProvider, useApp } from './context/AppContext'
import Navbar from './components/Navbar'
import ChatBubble from './components/ChatBubble'
import LoginPage from './pages/LoginPage'
import HomePage from './pages/HomePage'
import ProfilePage from './pages/ProfilePage'
import CreateProfilePage from './pages/CreateProfilePage'
import AdminPage from './pages/AdminPage'

function WithNav({ children }) {
  return (
    <>
      <Navbar />
      <main className="pt-16 min-h-screen bg-cp-bg">{children}</main>
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

      <Route path="/profile/:id" element={
        <ProtectedRoute>
          <WithNav><ProfilePage /></WithNav>
        </ProtectedRoute>
      } />

      <Route path="/create" element={
        <ProtectedRoute>
          <WithNav><CreateProfilePage /></WithNav>
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

export default function App() {
  return (
    <AppProvider>
      <div className="min-h-screen bg-cp-bg">
        <AppRoutes />
        {/* Floating chat bubble — always mounted so state persists across navigation */}
        <ChatBubble />
      </div>
    </AppProvider>
  )
}
