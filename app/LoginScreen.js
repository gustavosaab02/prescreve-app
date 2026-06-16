import { useState } from 'react';
import {
  View, Text, TextInput, TouchableOpacity,
  StyleSheet, KeyboardAvoidingView, Platform,
  ScrollView, ActivityIndicator, Modal, Alert
} from 'react-native';
import { sb } from '../supabase';

const TIPOS_CONSELHO = ['CRM', 'CRN', 'CRO', 'CRP', 'CREFITO', 'COREN'];

export default function LoginScreen({ onLogin, perfil, onBack }) {
  const [modo, setModo] = useState('login');
  const [loading, setLoading] = useState(false);
  const [erro, setErro] = useState('');

  // campos comuns
  const [email, setEmail] = useState('');
  const [senha, setSenha] = useState('');
  const [nome, setNome] = useState('');

  // campos paciente
  const [whatsapp, setWhatsapp] = useState('');
  const [cpf, setCpf] = useState('');

  // campos médico
  const [tipoConselho, setTipoConselho] = useState('CRM');
  const [numConselho, setNumConselho] = useState('');
  const [especialidade, setEspecialidade] = useState('');
  const [whatsappMedico, setWhatsappMedico] = useState('');
  const [modalTipo, setModalTipo] = useState(false);

  // esqueci senha
  const [forgotEmail, setForgotEmail] = useState('');
  const [forgotSent, setForgotSent] = useState(false);

  const isMedico = perfil === 'medico';

  function formatWA(v) {
    const d = v.replace(/\D/g, '').slice(0, 11);
    if (d.length <= 2) return d.length ? '(' + d : d;
    if (d.length <= 7) return '(' + d.slice(0,2) + ') ' + d.slice(2);
    if (d.length <= 10) return '(' + d.slice(0,2) + ') ' + d.slice(2,6) + '-' + d.slice(6);
    return '(' + d.slice(0,2) + ') ' + d.slice(2,7) + '-' + d.slice(7);
  }

  function formatCPF(v) {
    const d = v.replace(/\D/g, '').slice(0, 11);
    return d.replace(/(\d{3})(\d{3})(\d{3})(\d{2})/, '$1.$2.$3-$4')
            .replace(/(\d{3})(\d{3})(\d{3})/, '$1.$2.$3')
            .replace(/(\d{3})(\d{3})/, '$1.$2')
            .replace(/(\d{3})/, '$1');
  }

  async function doLogin() {
    if (!email || !senha) { setErro('Preencha email e senha'); return; }
    setLoading(true); setErro('');
    const { error } = await sb.auth.signInWithPassword({ email, password: senha });
    if (error) { setErro('Email ou senha incorretos'); setLoading(false); return; }
    const { data: { user } } = await sb.auth.getUser();
    // Passa null para forçar detectarPerfil — impede que o usuário entre na tela errada
    if (user?.id) onLogin(user, null);
    setLoading(false);
  }

  async function doRegister() {
    if (!nome || !email || !senha) { setErro('Preencha todos os campos obrigatórios'); return; }
    if (!isMedico && !whatsapp) { setErro('Informe seu telefone'); return; }
    if (!isMedico && cpf.replace(/\D/g,'').length !== 11) { setErro('Informe um CPF válido'); return; }
    if (senha.length < 6) { setErro('Senha deve ter pelo menos 6 caracteres'); return; }
    if (isMedico && !numConselho) { setErro('Informe o número do seu conselho'); return; }

    setLoading(true); setErro('');
    const { data, error } = await sb.auth.signUp({ email, password: senha });
    if (error) { setErro(error.message); setLoading(false); return; }
    const user = data.user;
    if (user) {
      if (isMedico) {
        const crm = `${tipoConselho}-${numConselho.trim()}`;
        await sb.from('doctors').upsert([{
          id: user.id,
          name: nome,
          email,
          crm,
          specialty: especialidade,
          whatsapp: whatsappMedico.replace(/\D/g, '') || null,
        }], { onConflict: 'id' });
      } else {
        await sb.from('patients').upsert([{
          id: user.id,
          name: nome,
          email,
          whatsapp: whatsapp.replace(/\D/g, '') || null,
          cpf: cpf.replace(/\D/g, '') || null,
        }], { onConflict: 'id' });
      }
    }
    onLogin(user, perfil);
    setLoading(false);
  }

  async function doForgot() {
    if (!forgotEmail.trim()) { setErro('Preencha seu email'); return; }
    setLoading(true); setErro('');
    const { error } = await sb.auth.resetPasswordForEmail(forgotEmail.trim(), {
      redirectTo: 'com.gustavosaab.synka://reset-password',
    });
    setLoading(false);
    if (error) { setErro('Erro ao enviar email. Verifique o endereço.'); return; }
    setForgotSent(true);
  }

  // TELA ESQUECI SENHA
  if (modo === 'forgot') {
    return (
      <KeyboardAvoidingView style={styles.flex} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <ScrollView contentContainerStyle={styles.container} keyboardShouldPersistTaps="handled">
          <View style={styles.header}>
            <Text style={styles.logo}>synka</Text>
            <Text style={styles.tagline}>saúde que se conecta</Text>
          </View>

          <View style={styles.card}>
            {!forgotSent ? (
              <>
                <Text style={{ fontSize: 17, fontWeight: '700', color: '#0f1f1a', marginBottom: 6 }}>Recuperar senha</Text>
                <Text style={{ fontSize: 13, color: '#888', marginBottom: 20, lineHeight: 18 }}>
                  Informe seu email e enviaremos um link para redefinir sua senha.
                </Text>
                <Text style={styles.label}>Email</Text>
                <TextInput
                  style={styles.input}
                  placeholder="seu@email.com"
                  placeholderTextColor="#999"
                  value={forgotEmail}
                  onChangeText={setForgotEmail}
                  keyboardType="email-address"
                  autoCapitalize="none"
                />
                {erro !== '' && <Text style={styles.erro}>{erro}</Text>}
                <TouchableOpacity style={styles.btn} onPress={doForgot} disabled={loading}>
                  {loading
                    ? <ActivityIndicator color="white" />
                    : <Text style={styles.btnText}>Enviar link de recuperação</Text>
                  }
                </TouchableOpacity>
                <TouchableOpacity style={styles.forgotBtn} onPress={() => { setModo('login'); setErro(''); setForgotSent(false); }}>
                  <Text style={styles.forgotText}>← Voltar para o login</Text>
                </TouchableOpacity>
              </>
            ) : (
              <>
                <Text style={{ fontSize: 36, textAlign: 'center', marginBottom: 14 }}>📧</Text>
                <Text style={{ fontSize: 17, fontWeight: '700', color: '#0f1f1a', textAlign: 'center', marginBottom: 8 }}>Email enviado!</Text>
                <Text style={{ fontSize: 13, color: '#888', textAlign: 'center', lineHeight: 20, marginBottom: 24 }}>
                  Verifique sua caixa de entrada e clique no link para redefinir sua senha.
                </Text>
                <TouchableOpacity style={styles.btn} onPress={() => { setModo('login'); setErro(''); setForgotSent(false); setForgotEmail(''); }}>
                  <Text style={styles.btnText}>Voltar para o login</Text>
                </TouchableOpacity>
              </>
            )}
          </View>

          <TouchableOpacity style={styles.back} onPress={onBack || (() => onLogin(null))}>
            <Text style={styles.backText}>← Trocar de perfil</Text>
          </TouchableOpacity>
        </ScrollView>
      </KeyboardAvoidingView>
    );
  }

  return (
    <KeyboardAvoidingView style={styles.flex} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <ScrollView contentContainerStyle={styles.container} keyboardShouldPersistTaps="handled">

        <View style={styles.header}>
          <Text style={styles.logo}>synka</Text>
          <Text style={styles.tagline}>saúde que se conecta</Text>
          <View style={styles.tipoBadge}>
            <Text style={styles.tipoBadgeText}>{isMedico ? '🩺 Área do médico' : '💊 Área do paciente'}</Text>
          </View>
        </View>

        <View style={styles.card}>
          {/* Tabs */}
          <View style={styles.tabs}>
            <TouchableOpacity
              style={[styles.tab, modo === 'login' && styles.tabActive]}
              onPress={() => { setModo('login'); setErro(''); }}>
              <Text style={[styles.tabText, modo === 'login' && styles.tabTextActive]}>Entrar</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.tab, modo === 'register' && styles.tabActive]}
              onPress={() => { setModo('register'); setErro(''); }}>
              <Text style={[styles.tabText, modo === 'register' && styles.tabTextActive]}>Criar conta</Text>
            </TouchableOpacity>
          </View>

          {/* CADASTRO */}
          {modo === 'register' && (
            <>
              <Text style={styles.label}>Nome completo</Text>
              <TextInput
                style={styles.input}
                placeholder={isMedico ? 'Dr. Nome Sobrenome' : 'Seu nome'}
                placeholderTextColor="#999"
                value={nome}
                onChangeText={setNome}
                autoCapitalize="words"
              />

              {isMedico && (
                <>
                  <Text style={styles.label}>Conselho profissional</Text>
                  <View style={styles.row}>
                    <TouchableOpacity style={styles.selectorBtn} onPress={() => setModalTipo(true)}>
                      <Text style={styles.selectorText}>{tipoConselho}</Text>
                      <Text style={styles.selectorArrow}>▾</Text>
                    </TouchableOpacity>
                    <TextInput
                      style={[styles.input, styles.inputFlex]}
                      placeholder="Número (ex: 123456)"
                      placeholderTextColor="#999"
                      value={numConselho}
                      onChangeText={setNumConselho}
                    />
                  </View>

                  <Text style={styles.label}>Especialidade</Text>
                  <TextInput
                    style={styles.input}
                    placeholder="Ex: Dermatologia"
                    placeholderTextColor="#999"
                    value={especialidade}
                    onChangeText={setEspecialidade}
                    autoCapitalize="words"
                  />

                  <Text style={styles.label}>Telefone <Text style={styles.opcional}>(opcional)</Text></Text>
                  <TextInput
                    style={styles.input}
                    placeholder="(11) 99999-9999"
                    placeholderTextColor="#999"
                    value={whatsappMedico}
                    onChangeText={v => setWhatsappMedico(formatWA(v))}
                    keyboardType="phone-pad"
                  />
                </>
              )}

              {!isMedico && (
                <>
                  <Text style={styles.label}>Telefone</Text>
                  <TextInput
                    style={styles.input}
                    placeholder="(11) 99999-9999"
                    placeholderTextColor="#999"
                    value={whatsapp}
                    onChangeText={v => setWhatsapp(formatWA(v))}
                    keyboardType="phone-pad"
                  />
                  <Text style={styles.label}>CPF</Text>
                  <TextInput
                    style={styles.input}
                    placeholder="000.000.000-00"
                    placeholderTextColor="#999"
                    value={cpf}
                    onChangeText={v => setCpf(formatCPF(v))}
                    keyboardType="number-pad"
                  />
                </>
              )}
            </>
          )}

          {/* EMAIL E SENHA */}
          <Text style={styles.label}>Email</Text>
          <TextInput
            style={styles.input}
            placeholder="seu@email.com"
            placeholderTextColor="#999"
            value={email}
            onChangeText={setEmail}
            keyboardType="email-address"
            autoCapitalize="none"
          />

          <Text style={styles.label}>Senha</Text>
          <TextInput
            style={styles.input}
            placeholder="••••••••"
            placeholderTextColor="#999"
            value={senha}
            onChangeText={setSenha}
            secureTextEntry
          />

          {erro !== '' && <Text style={styles.erro}>{erro}</Text>}

          <TouchableOpacity style={styles.btn} onPress={modo === 'login' ? doLogin : doRegister} disabled={loading}>
            {loading
              ? <ActivityIndicator color="white" />
              : <Text style={styles.btnText}>{modo === 'login' ? 'Entrar' : 'Criar conta'}</Text>
            }
          </TouchableOpacity>

          {modo === 'login' && (
            <TouchableOpacity style={styles.forgotBtn} onPress={() => { setModo('forgot'); setErro(''); setForgotEmail(email); }}>
              <Text style={styles.forgotText}>Esqueci minha senha</Text>
            </TouchableOpacity>
          )}
        </View>

        <TouchableOpacity style={styles.back} onPress={onBack || (() => onLogin(null))}>
          <Text style={styles.backText}>← Trocar de perfil</Text>
        </TouchableOpacity>

      </ScrollView>

      {/* Modal tipo de conselho */}
      <Modal visible={modalTipo} transparent animationType="fade" onRequestClose={() => setModalTipo(false)}>
        <TouchableOpacity style={styles.modalOverlay} activeOpacity={1} onPress={() => setModalTipo(false)}>
          <View style={styles.modalBox}>
            <Text style={styles.modalTitle}>Tipo de conselho</Text>
            {TIPOS_CONSELHO.map(tipo => (
              <TouchableOpacity
                key={tipo}
                style={[styles.modalItem, tipoConselho === tipo && styles.modalItemActive]}
                onPress={() => { setTipoConselho(tipo); setModalTipo(false); }}>
                <Text style={[styles.modalItemText, tipoConselho === tipo && styles.modalItemTextActive]}>
                  {tipo}
                </Text>
                {tipoConselho === tipo && <Text style={styles.modalCheck}>✓</Text>}
              </TouchableOpacity>
            ))}
          </View>
        </TouchableOpacity>
      </Modal>

    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1, backgroundColor: '#0f1f1a' },
  container: { flexGrow: 1, justifyContent: 'center', padding: 24, paddingBottom: 40 },
  header: { alignItems: 'center', marginBottom: 32 },
  logo: { fontSize: 42, fontWeight: '800', color: 'white', letterSpacing: -2 },
  tagline: { fontSize: 13, color: '#6b9e8e', marginTop: 4, letterSpacing: 0.5 },
  tipoBadge: { backgroundColor: 'rgba(255,255,255,0.1)', borderRadius: 20, paddingHorizontal: 14, paddingVertical: 6, marginTop: 16 },
  tipoBadgeText: { fontSize: 13, color: 'white', fontWeight: '500' },
  card: { backgroundColor: 'white', borderRadius: 20, padding: 24 },
  tabs: { flexDirection: 'row', backgroundColor: '#f4f4f4', borderRadius: 10, padding: 3, marginBottom: 20 },
  tab: { flex: 1, paddingVertical: 8, alignItems: 'center', borderRadius: 8 },
  tabActive: { backgroundColor: 'white' },
  tabText: { fontSize: 13, color: '#999', fontWeight: '500' },
  tabTextActive: { color: '#0f1f1a', fontWeight: '600' },
  label: { fontSize: 12, fontWeight: '600', color: '#666', marginBottom: 6, marginTop: 14, textTransform: 'uppercase', letterSpacing: 0.5 },
  opcional: { fontWeight: '400', color: '#aaa', textTransform: 'none', fontSize: 11 },
  input: { backgroundColor: '#f8f8f8', borderRadius: 10, padding: 14, fontSize: 15, color: '#0f1f1a', borderWidth: 1, borderColor: '#eee' },
  row: { flexDirection: 'row', gap: 8, alignItems: 'center' },
  selectorBtn: { backgroundColor: '#f8f8f8', borderRadius: 10, paddingHorizontal: 14, paddingVertical: 14, borderWidth: 1, borderColor: '#eee', flexDirection: 'row', alignItems: 'center', gap: 6 },
  selectorText: { fontSize: 15, color: '#0f1f1a', fontWeight: '600' },
  selectorArrow: { fontSize: 11, color: '#999' },
  inputFlex: { flex: 1 },
  erro: { color: '#e53935', fontSize: 13, marginTop: 10, textAlign: 'center' },
  btn: { backgroundColor: '#1D9E75', borderRadius: 12, padding: 16, alignItems: 'center', marginTop: 20 },
  btnText: { color: 'white', fontWeight: '700', fontSize: 15 },
  forgotBtn: { alignItems: 'center', marginTop: 16 },
  forgotText: { fontSize: 13, color: '#1D9E75', fontWeight: '500' },
  back: { alignItems: 'center', marginTop: 24 },
  backText: { color: '#6b9e8e', fontSize: 14 },
  modalOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'center', alignItems: 'center', padding: 40 },
  modalBox: { backgroundColor: 'white', borderRadius: 16, padding: 8, width: '100%' },
  modalTitle: { fontSize: 13, fontWeight: '700', color: '#666', textAlign: 'center', paddingVertical: 12, textTransform: 'uppercase', letterSpacing: 0.5 },
  modalItem: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingVertical: 14, paddingHorizontal: 16, borderRadius: 10 },
  modalItemActive: { backgroundColor: '#f0f9f5' },
  modalItemText: { fontSize: 16, color: '#0f1f1a' },
  modalItemTextActive: { color: '#1D9E75', fontWeight: '600' },
  modalCheck: { color: '#1D9E75', fontSize: 16, fontWeight: '700' },
});