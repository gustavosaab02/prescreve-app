import { StatusBar } from 'expo-status-bar';
import { StyleSheet, Text, View, TouchableOpacity, Animated, ActivityIndicator } from 'react-native';
import { useState, useRef, useEffect } from 'react';
import { sb } from './src/supabase';
import LoginScreen from './src/screens/LoginScreen';
import DoctorScreen from './src/screens/DoctorScreen';
import PatientScreen from './src/screens/PatientScreen';

export default function App() {
  const [perfil, setPerfil] = useState(null);
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);
  const fadeAnim = useRef(new Animated.Value(0)).current;
  const slideAnim = useRef(new Animated.Value(40)).current;

  useEffect(() => {
    sb.auth.getSession().then(({ data: { session } }) => {
      if (session?.user) {
        setUser(session.user);
        detectarPerfil(session.user.id);
      } else {
        setLoading(false);
      }
    });
    const { data: { subscription } } = sb.auth.onAuthStateChange((event, session) => {
      if (!session?.user) {
        setUser(null); setPerfil(null); setLoading(false);
      } else if (event === 'SIGNED_IN') {
        // Cobre deep links (ex: reset de senha) — getSession já trata o login normal
        setUser(session.user);
        detectarPerfil(session.user.id);
      }
    });
    return () => subscription.unsubscribe();
  }, []);

  async function detectarPerfil(userId) {
    const { data: doctor } = await sb.from('doctors').select('id').eq('id', userId).single();
    if (doctor) { setPerfil('medico'); setLoading(false); return; }
    const { data: patient } = await sb.from('patients').select('id').eq('id', userId).single();
    if (patient) { setPerfil('paciente'); setLoading(false); return; }
    setLoading(false);
  }

  useEffect(() => {
    if (!loading && !user) {
      Animated.parallel([
        Animated.timing(fadeAnim, { toValue: 1, duration: 800, useNativeDriver: true }),
        Animated.timing(slideAnim, { toValue: 0, duration: 800, useNativeDriver: true }),
      ]).start();
    }
  }, [loading, user]);

  async function handleLogin(u, perfilEscolhido) {
    if (!u) { setUser(null); setPerfil(null); return; }
    setUser(u);
    if (perfilEscolhido) { setPerfil(perfilEscolhido); } else { await detectarPerfil(u.id); }
  }

  function handleLogout() {
    sb.auth.signOut();
    setUser(null);
    setPerfil(null);
  }

  if (loading) {
    return (
      <View style={styles.container}>
        <StatusBar style="light" />
        <ActivityIndicator color="#4a9e7f" />
      </View>
    );
  }

  if (user && perfil === 'medico') return <DoctorScreen user={user} onLogout={handleLogout} />;
  if (user && perfil === 'paciente') return <PatientScreen user={user} onLogout={handleLogout} />;

  if (perfil) {
    return <LoginScreen perfil={perfil} onLogin={handleLogin} onBack={() => setPerfil(null)} />;
  }

  return (
    <View style={styles.container}>
      <StatusBar style="light" />
      <Animated.View style={[styles.content, { opacity: fadeAnim, transform: [{ translateY: slideAnim }] }]}>
        <View style={styles.logoArea}>
          <Text style={styles.logoText}>Synka</Text>
          <View style={styles.logoDot} />
          <Text style={styles.tagline}>Recomendações médicas inteligentes</Text>
        </View>
        <View style={styles.cards}>
          <TouchableOpacity style={styles.cardMedico} onPress={() => setPerfil('medico')} activeOpacity={0.85}>
            <View style={styles.cardIconCircle}>
              <Text style={styles.cardEmoji}>🩺</Text>
            </View>
            <View style={styles.cardTexts}>
              <Text style={styles.cardTitleDark}>Sou médico</Text>
              <Text style={styles.cardDescDark}>Recomende produtos e suplementos{'\n'}aos seus pacientes</Text>
            </View>
            <Text style={styles.cardArrow}>→</Text>
          </TouchableOpacity>
          <TouchableOpacity style={styles.cardPaciente} onPress={() => setPerfil('paciente')} activeOpacity={0.85}>
            <View style={[styles.cardIconCircle, styles.cardIconCircleLight]}>
              <Text style={styles.cardEmoji}>💊</Text>
            </View>
            <View style={styles.cardTexts}>
              <Text style={styles.cardTitleLight}>Sou paciente</Text>
              <Text style={styles.cardDescLight}>Veja as recomendações{'\n'}do seu médico</Text>
            </View>
            <Text style={[styles.cardArrow, { color: 'rgba(255,255,255,0.5)' }]}>→</Text>
          </TouchableOpacity>
        </View>
        <Text style={styles.footer}>synkasaude.com.br</Text>
      </Animated.View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#0f1f1a', alignItems: 'center', justifyContent: 'center', padding: 24 },
  content: { width: '100%', alignItems: 'center' },
  logoArea: { alignItems: 'center', marginBottom: 52 },
  logoText: { fontSize: 38, fontWeight: '700', color: 'white', letterSpacing: -1 },
  logoDot: { width: 6, height: 6, borderRadius: 3, backgroundColor: '#4a9e7f', marginTop: 6, marginBottom: 12 },
  tagline: { fontSize: 13, color: '#6b9e8e', letterSpacing: 0.3 },
  cards: { width: '100%', gap: 12 },
  cardMedico: { backgroundColor: 'white', borderRadius: 20, padding: 22, flexDirection: 'row', alignItems: 'center', gap: 16 },
  cardPaciente: { backgroundColor: '#2d5a4a', borderRadius: 20, padding: 22, flexDirection: 'row', alignItems: 'center', gap: 16, borderWidth: 1, borderColor: '#3d7a62' },
  cardIconCircle: { width: 52, height: 52, borderRadius: 26, backgroundColor: '#f0f7f4', alignItems: 'center', justifyContent: 'center' },
  cardIconCircleLight: { backgroundColor: 'rgba(255,255,255,0.1)' },
  cardEmoji: { fontSize: 24 },
  cardTexts: { flex: 1 },
  cardTitleDark: { fontSize: 17, fontWeight: '700', color: '#0f1f1a', marginBottom: 3 },
  cardDescDark: { fontSize: 12, color: '#6b8a80', lineHeight: 17 },
  cardTitleLight: { fontSize: 17, fontWeight: '700', color: 'white', marginBottom: 3 },
  cardDescLight: { fontSize: 12, color: 'rgba(255,255,255,0.6)', lineHeight: 17 },
  cardArrow: { fontSize: 20, color: '#4a7c6f', fontWeight: '300' },
  footer: { marginTop: 40, fontSize: 12, color: '#3d5a50', letterSpacing: 0.5 },
});