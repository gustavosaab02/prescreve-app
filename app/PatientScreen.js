// PatientScreen v3 - com notificações reais
import React, { useState, useEffect, useRef } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Ionicons } from '@expo/vector-icons';
import * as Notifications from 'expo-notifications';
import {
  View, Text, StyleSheet, TouchableOpacity, ScrollView,
  ActivityIndicator, FlatList, Alert, Modal, Linking,
  SafeAreaView, Platform, RefreshControl, TextInput, Clipboard
} from 'react-native';
import * as ImagePicker from 'expo-image-picker';
import * as DocumentPicker from 'expo-document-picker';
import * as FileSystem from 'expo-file-system/legacy';
import * as Print from 'expo-print';
import * as Sharing from 'expo-sharing';
import { sb } from '../supabase';

const SUPABASE_URL = 'https://iwrfgdfxvyqdkqdtrrxg.supabase.co';
const SUPABASE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Iml3cmZnZGZ4dnlxZGtxZHRycnhnIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzQzNjIxMzEsImV4cCI6MjA4OTkzODEzMX0.kQr7K_W-B2bcEYgQpxIrNFhORyiYT6_SZkfpC4S_AfQ';

// Configuração de como as notificações aparecem quando o app está aberto
Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowAlert: true,
    shouldPlaySound: true,
    shouldSetBadge: true,
  }),
});

const TABS = [
  { key: 'inicio', label: 'Início', icon: 'home-outline', iconActive: 'home' },
  { key: 'receitas', label: 'Receitas', icon: 'document-text-outline', iconActive: 'document-text' },
  { key: 'lembretes', label: 'Lembretes', icon: 'notifications-outline', iconActive: 'notifications' },
  { key: 'dieta', label: 'Dieta', icon: 'nutrition-outline', iconActive: 'nutrition' },
  { key: 'perfil', label: 'Perfil', icon: 'person-outline', iconActive: 'person' },
];

function parseManipulado(notes) {
  try { const o = JSON.parse(notes); if (o && o.__manipulado) return o; } catch(e) {}
  return null;
}

const PALAVRAS_CONTROLADO = [
  'tarja vermelha','tarja preta','controlado','clonazepam','alprazolam',
  'diazepam','lorazepam','bromazepam','midazolam','rivotril','frontal',
  'valium','lexotan','ritalina','concerta','venvanse','vyvanse',
  'metilfenidato','modafinil','zolpidem','stilnox','morfina','codeína',
  'tramadol','oxicodona','fentanil','buprenorfina','metadona','quetiapina',
  'olanzapina','risperidona','haloperidol','clozapina','carbamazepina',
  'valproato','fenitoína','fenobarbital','isotretinoína','roacutan','anfetamina',
];

function precisaReceita(nomeProduto) {
  if (!nomeProduto) return false;
  const lower = nomeProduto.toLowerCase();
  return PALAVRAS_CONTROLADO.some(p => lower.includes(p));
}

// ─── FUNÇÕES DE NOTIFICAÇÃO ───────────────────────────────────────────────────

async function pedirPermissaoNotificacoes() {
  const { status: existingStatus } = await Notifications.getPermissionsAsync();
  let finalStatus = existingStatus;
  if (existingStatus !== 'granted') {
    const { status } = await Notifications.requestPermissionsAsync();
    finalStatus = status;
  }
  return finalStatus === 'granted';
}

async function agendarNotificacaoDiaria(produto, hora, identifier) {
  // Cancela a anterior se existir
  if (identifier) {
    try { await Notifications.cancelScheduledNotificationAsync(identifier); } catch(e) {}
  }

  const [horas, minutos] = hora.split(':').map(Number);

  const id = await Notifications.scheduleNotificationAsync({
    content: {
      title: '💊 Hora do remédio!',
      body: `Não esqueça: ${produto}`,
      sound: true,
      interruptionLevel: 'timeSensitive',
    },
    trigger: {
      type: 'daily',
      hour: horas,
      minute: minutos,
      repeats: true,
    },
  });

  return id;
}

async function agendarNotificacaoUnica(produto, hora) {
  const [horas, minutos] = hora.split(':').map(Number);
  const agora = new Date();
  const dataDisparo = new Date();
  dataDisparo.setHours(horas, minutos, 0, 0);

  // Se o horário já passou hoje, agenda para amanhã
  if (dataDisparo <= agora) {
    dataDisparo.setDate(dataDisparo.getDate() + 1);
  }

  const id = await Notifications.scheduleNotificationAsync({
    content: {
      title: '💊 Lembrete de remédio',
      body: produto,
      sound: true,
      interruptionLevel: 'timeSensitive',
    },
    trigger: { date: dataDisparo },
  });

  return id;
}

async function agendarLembreteRecompra(produto, diasRestantes) {
  const dataDisparo = new Date();
  dataDisparo.setDate(dataDisparo.getDate() + diasRestantes);
  dataDisparo.setHours(9, 0, 0, 0);

  const id = await Notifications.scheduleNotificationAsync({
    content: {
      title: '🛒 Hora de recomprar!',
      body: `Seu ${produto} está acabando. Compre antes que acabe!`,
      sound: true,
      interruptionLevel: 'timeSensitive',
    },
    trigger: { date: dataDisparo },
  });

  return id;
}

async function cancelarNotificacao(identifier) {
  if (!identifier) return;
  try { await Notifications.cancelScheduledNotificationAsync(identifier); } catch(e) {}
}

// ─── COMPONENTE PRINCIPAL ─────────────────────────────────────────────────────

// ─── QUESTIONÁRIO DE SAÚDE ────────────────────────────────────────────────────
function HealthQuestionnaire({ patient, onComplete, onSkip }) {
  const [step, setStep] = useState(1);
  const TOTAL_STEPS = 3;
  const [condicoes, setCondicoes] = useState([]);
  const [estilo, setEstilo] = useState([]);
  const [objetivos, setObjetivos] = useState([]);
  const [alergias, setAlergias] = useState([]);
  const [medicamentos, setMedicamentos] = useState('');
  const [outrasCond, setOutrasCond] = useState('');
  const [outrasEst, setOutrasEst] = useState('');
  const [outrasObj, setOutrasObj] = useState('');
  const [outrasAlerg, setOutrasAlerg] = useState('');
  const [consentido, setConsentido] = useState(false);
  const [salvando, setSalvando] = useState(false);

  function toggleItem(list, setList, val) {
    if (val === 'Nenhuma') { setList(['Nenhuma']); return; }
    setList(prev => {
      const sem = prev.filter(v => v !== 'Nenhuma');
      return sem.includes(val) ? sem.filter(v => v !== val) : [...sem, val];
    });
  }

  async function salvar() {
    setSalvando(true);
    const payload = {
      condicoes: [...condicoes, ...(outrasCond.trim() ? [outrasCond.trim()] : [])],
      estilo: [...estilo, ...(outrasEst.trim() ? [outrasEst.trim()] : [])],
      objetivos: [...objetivos, ...(outrasObj.trim() ? [outrasObj.trim()] : [])],
      alergias: [...alergias, ...(outrasAlerg.trim() ? [outrasAlerg.trim()] : [])],
      medicamentos_em_uso: medicamentos.trim(),
      consentido,
      preenchido_em: new Date().toISOString(),
    };
    await sb.from('patients').update({ health_profile: payload }).eq('id', patient.id);
    setSalvando(false);
    onComplete(payload);
  }

  async function pular() {
    await sb.from('patients').update({ health_profile: { skipped: true } }).eq('id', patient.id);
    onSkip();
  }

  const COND = ['Diabetes','Hipertensão','Hipotireoidismo','Hipertireoidismo','Colesterol alto','Obesidade','Ansiedade','Depressão','Enxaqueca','Fibromialgia','Problemas de pele','Queda de cabelo','Refluxo / gastrite','Doença celíaca','Endometriose','SOP','Asma / bronquite','Nenhuma'];
  const ESTIL = ['Pratico exercício regularmente','Sedentário','Vegetariano / vegano','Fumante','Grávida / amamentando','Dificuldade para dormir','Estresse alto','Uso álcool regularmente','Trabalho noturno'];
  const OBJ = ['Perder peso','Ganhar massa muscular','Melhorar imunidade','Mais energia / disposição','Equilibrar hormônios','Saúde da pele','Saúde intestinal','Melhorar o sono','Saúde mental','Fertilidade','Saúde cardiovascular','Controlar dor crônica','Bem-estar geral'];
  const ALERG = ['Dipirona','Penicilina','AAS / Aspirina','Ibuprofeno','Sulfa','Látex','Frutos do mar','Glúten','Lactose','Nenhuma conhecida'];

  function Chip({ label, selected, onPress }) {
    return (
      <TouchableOpacity
        onPress={onPress}
        style={{ paddingHorizontal: 13, paddingVertical: 8, borderRadius: 100, borderWidth: 1.5, borderColor: selected ? '#1D9E75' : '#e0e0e0', backgroundColor: selected ? '#e8f5f0' : 'white', margin: 4 }}
      >
        <Text style={{ fontSize: 13, fontWeight: selected ? '700' : '500', color: selected ? '#1D9E75' : '#444' }}>{label}</Text>
      </TouchableOpacity>
    );
  }

  const stepTitles = ['Seu perfil de saúde', 'Estilo de vida', 'Objetivos e alergias'];
  const stepSubs = [
    'Essas informações ajudam seu médico a personalizar as recomendações.',
    'Como é a sua rotina?',
    'O que você quer alcançar e o que precisamos saber sobre alergias.',
  ];

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: '#f5f7f6' }}>
      {/* Header */}
      <View style={{ paddingHorizontal: 20, paddingVertical: 16, backgroundColor: 'white', borderBottomWidth: 1, borderBottomColor: '#f0f0f0' }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
          <Text style={{ fontSize: 13, fontWeight: '600', color: '#1D9E75' }}>Passo {step} de {TOTAL_STEPS}</Text>
          <TouchableOpacity onPress={pular}>
            <Text style={{ fontSize: 13, color: '#bbb' }}>Pular</Text>
          </TouchableOpacity>
        </View>
        <View style={{ height: 4, backgroundColor: '#e0e0e0', borderRadius: 2 }}>
          <View style={{ height: 4, width: `${(step/TOTAL_STEPS)*100}%`, backgroundColor: '#1D9E75', borderRadius: 2 }} />
        </View>
      </View>

      <ScrollView contentContainerStyle={{ padding: 24, paddingBottom: 40 }} showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled">
        <Text style={{ fontSize: 22, fontWeight: '700', color: '#0f1f1a', marginBottom: 6 }}>{stepTitles[step-1]}</Text>
        <Text style={{ fontSize: 14, color: '#888', marginBottom: 24, lineHeight: 20 }}>{stepSubs[step-1]}</Text>

        {step === 1 && (
          <>
            <Text style={{ fontSize: 13, fontWeight: '700', color: '#0f1f1a', marginBottom: 12 }}>Condições de saúde</Text>
            <Text style={{ fontSize: 12, color: '#aaa', marginBottom: 10 }}>Selecione todas que se aplicam</Text>
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', marginHorizontal: -4, marginBottom: 8 }}>
              {COND.map(c => <Chip key={c} label={c} selected={condicoes.includes(c)} onPress={() => toggleItem(condicoes, setCondicoes, c)} />)}
            </View>
            <TextInput
              style={{ backgroundColor: 'white', borderRadius: 12, padding: 12, fontSize: 13, color: '#0f1f1a', borderWidth: 1, borderColor: '#e0e0e0', marginBottom: 24 }}
              placeholder="Outra condição? Escreva aqui..."
              placeholderTextColor="#bbb"
              value={outrasCond}
              onChangeText={setOutrasCond}
            />
            <Text style={{ fontSize: 13, fontWeight: '700', color: '#0f1f1a', marginBottom: 10 }}>Medicamentos em uso regular</Text>
            <TextInput
              style={{ backgroundColor: 'white', borderRadius: 12, padding: 12, fontSize: 13, color: '#0f1f1a', borderWidth: 1, borderColor: '#e0e0e0', minHeight: 80, textAlignVertical: 'top' }}
              placeholder="Ex: Metformina 500mg, Levotiroxina 50mcg..."
              placeholderTextColor="#bbb"
              value={medicamentos}
              onChangeText={setMedicamentos}
              multiline
            />
          </>
        )}

        {step === 2 && (
          <>
            <Text style={{ fontSize: 13, fontWeight: '700', color: '#0f1f1a', marginBottom: 10 }}>Estilo de vida</Text>
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', marginHorizontal: -4, marginBottom: 8 }}>
              {ESTIL.map(e => <Chip key={e} label={e} selected={estilo.includes(e)} onPress={() => toggleItem(estilo, setEstilo, e)} />)}
            </View>
            <TextInput
              style={{ backgroundColor: 'white', borderRadius: 12, padding: 12, fontSize: 13, color: '#0f1f1a', borderWidth: 1, borderColor: '#e0e0e0' }}
              placeholder="Outro? Escreva aqui..."
              placeholderTextColor="#bbb"
              value={outrasEst}
              onChangeText={setOutrasEst}
            />
          </>
        )}

        {step === 3 && (
          <>
            <Text style={{ fontSize: 13, fontWeight: '700', color: '#0f1f1a', marginBottom: 10 }}>Objetivos de saúde</Text>
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', marginHorizontal: -4, marginBottom: 8 }}>
              {OBJ.map(o => <Chip key={o} label={o} selected={objetivos.includes(o)} onPress={() => toggleItem(objetivos, setObjetivos, o)} />)}
            </View>
            <TextInput
              style={{ backgroundColor: 'white', borderRadius: 12, padding: 12, fontSize: 13, color: '#0f1f1a', borderWidth: 1, borderColor: '#e0e0e0', marginBottom: 24 }}
              placeholder="Outro objetivo?"
              placeholderTextColor="#bbb"
              value={outrasObj}
              onChangeText={setOutrasObj}
            />
            <Text style={{ fontSize: 13, fontWeight: '700', color: '#0f1f1a', marginBottom: 10 }}>Alergias a medicamentos</Text>
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', marginHorizontal: -4, marginBottom: 8 }}>
              {ALERG.map(a => <Chip key={a} label={a} selected={alergias.includes(a)} onPress={() => toggleItem(alergias, setAlergias, a)} />)}
            </View>
            <TextInput
              style={{ backgroundColor: 'white', borderRadius: 12, padding: 12, fontSize: 13, color: '#0f1f1a', borderWidth: 1, borderColor: '#e0e0e0', marginBottom: 24 }}
              placeholder="Outra alergia?"
              placeholderTextColor="#bbb"
              value={outrasAlerg}
              onChangeText={setOutrasAlerg}
            />
            <TouchableOpacity
              style={{ flexDirection: 'row', alignItems: 'flex-start', gap: 12, backgroundColor: 'white', borderRadius: 14, padding: 16, borderWidth: 1.5, borderColor: consentido ? '#1D9E75' : '#e0e0e0' }}
              onPress={() => setConsentido(!consentido)}
            >
              <View style={{ width: 22, height: 22, borderRadius: 6, borderWidth: 2, borderColor: consentido ? '#1D9E75' : '#ccc', backgroundColor: consentido ? '#1D9E75' : 'white', alignItems: 'center', justifyContent: 'center', flexShrink: 0, marginTop: 1 }}>
                {consentido && <Text style={{ color: 'white', fontSize: 13, fontWeight: '700' }}>✓</Text>}
              </View>
              <Text style={{ fontSize: 12, color: '#666', flex: 1, lineHeight: 18 }}>
                <Text style={{ fontWeight: '700' }}>Aceito compartilhar estas informações de forma anônima</Text> para pesquisas de saúde. Meus dados nunca serão vinculados ao meu nome ou vendidos individualmente.
              </Text>
            </TouchableOpacity>
          </>
        )}
      </ScrollView>

      <View style={{ padding: 20, paddingBottom: 32, backgroundColor: 'white', borderTopWidth: 1, borderTopColor: '#f0f0f0', gap: 10 }}>
        <TouchableOpacity
          style={{ backgroundColor: '#1D9E75', borderRadius: 14, padding: 16, alignItems: 'center', opacity: salvando ? 0.7 : 1 }}
          onPress={step < TOTAL_STEPS ? () => setStep(step + 1) : salvar}
          disabled={salvando}
        >
          <Text style={{ color: 'white', fontWeight: '700', fontSize: 16 }}>
            {salvando ? 'Salvando...' : step < TOTAL_STEPS ? 'Continuar →' : 'Salvar perfil de saúde ✓'}
          </Text>
        </TouchableOpacity>
        {step > 1 && (
          <TouchableOpacity onPress={() => setStep(step - 1)} style={{ alignItems: 'center', padding: 8 }}>
            <Text style={{ fontSize: 14, color: '#999' }}>← Voltar</Text>
          </TouchableOpacity>
        )}
      </View>
    </SafeAreaView>
  );
}


export default function PatientScreen({ user, onLogout }) {
  const [tab, setTab] = useState('inicio');
  const [showHealthQuestionnaire, setShowHealthQuestionnaire] = useState(false);
  const [produtoLembrete, setProdutoLembrete] = useState(null);
  const [showAddProprio, setShowAddProprio] = useState(false);
  const [proprioNome, setProprioNome] = useState('');
  const [proprioMedico, setProprioMedico] = useState('');
  const [proprioDosage, setPropriosDosage] = useState('');
  const [proprioFreq, setProprioFreq] = useState('');
  const [proprioDur, setPropriosDur] = useState('');
  const notificationListener = useRef();
  const responseListener = useRef();

  // Pedir permissão ao abrir o app
  useEffect(() => {
    pedirPermissaoNotificacoes();

    // Listener para quando chega notificação com app aberto
    notificationListener.current = Notifications.addNotificationReceivedListener(notification => {
      console.log('Notificação recebida:', notification);
    });

    // Listener para quando usuário toca na notificação
    responseListener.current = Notifications.addNotificationResponseReceivedListener(response => {
      setTab('lembretes');
    });

    return () => {
         notificationListener.current?.remove();
    responseListener.current?.remove();
    };
  }, []);

  async function salvarProprio() {
    if (!proprioNome.trim()) { Alert.alert('Digite o nome do remédio'); return; }
    const novo = {
      id: 'proprio-' + Date.now(),
      status: 'not_started',
      purchased_at: null,
      created_at: new Date().toISOString(),
      dosage: proprioDosage,
      frequency: proprioFreq,
      duration: proprioDur,
      products: { name: proprioNome, brand: proprioMedico },
      doctors: { name: proprioMedico || 'Adicionado por você' },
      _proprio: true,
    };
    const saved = JSON.parse(await AsyncStorage.getItem('prescreve_proprios') || '[]');
    saved.push(novo);
    await AsyncStorage.setItem('prescreve_proprios', JSON.stringify(saved));
    setScanRecs(prev => [novo, ...prev]);
    setShowAddProprio(false);
    setProprioNome(''); setProprioMedico(''); setPropriosDosage(''); setProprioFreq(''); setPropriosDur('');
    Alert.alert('Remédio adicionado!');
  }

  const [bulaModal, setBulaModal] = useState({ visible: false, nome: '', marca: '', texto: '', loading: false });

  async function abrirBula(nome, marca) {
    setBulaModal({ visible: true, nome, marca, texto: '', loading: true });
    try {
      const session = await sb.auth.getSession();
      const token = session?.data?.session?.access_token || SUPABASE_KEY;
      const res = await fetch('https://iwrfgdfxvyqdkqdtrrxg.supabase.co/functions/v1/bula-resumida', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + token },
        body: JSON.stringify({ produto: nome, marca: marca || '' })
      });
      const data = await res.json();
      const texto = (data.text || '').split('---BULA_COMPLETA---')[0].trim();
      setBulaModal(prev => ({ ...prev, loading: false, texto }));
    } catch(e) {
      setBulaModal(prev => ({ ...prev, loading: false, texto: 'Não foi possível carregar a bula.' }));
    }
  }

  const [patient, setPatient] = useState(null);
  const [recs, setRecs] = useState([]);
  const [scanRecs, setScanRecs] = useState([]);
  const [loading, setLoading] = useState(true);
  const [scanLoading, setScanLoading] = useState(false);

  useEffect(() => {
    if (!user?.id) { setLoading(false); return; }
    loadData();
  }, [user]);

  async function loadData() {
    setLoading(true);
    try {
      const { data: pats } = await sb.from('patients').select('*').eq('email', user.email);
      const patList = pats || [];
      setPatient(patList[0] || { name: user.email, email: user.email });

      let recsData = [];
      if (patList.length > 0) {
        const ids = patList.map(p => p.id);
        const { data } = await sb.from('recommendations')
          .select('id, created_at, status, dosage, frequency, duration, notes, return_date, product_id, doctor_id, patient_id, products:product_id(id, name, brand, category, purchase_url), doctors:doctor_id(id, name, specialty, crm)')
          .in('patient_id', ids)
          .order('created_at', { ascending: false });
        recsData = data || [];
      }
      setRecs(recsData);

      // Show health questionnaire if not filled yet
      const pat = patList[0];
      if (pat && !pat.health_profile) {
        setShowHealthQuestionnaire(true);
      }

      // Salva expo_push_token no banco
      try {
        const { status } = await Notifications.getPermissionsAsync();
        if (status === 'granted' && pat?.id) {
          const tokenData = await Notifications.getExpoPushTokenAsync({
            projectId: 'e5fec6c1-e462-4753-8b25-7a2f2651f788',
          });
          const expoPushToken = tokenData?.data;
          if (expoPushToken && expoPushToken !== pat.expo_push_token) {
            await sb.from('patients').update({ expo_push_token: expoPushToken }).eq('id', pat.id);
          }
        }
      } catch(e) { console.log('Push token error:', e); }

      const proprios = JSON.parse(await AsyncStorage.getItem('prescreve_proprios') || '[]');
      setScanRecs(prev => {
        const semProprios = prev.filter(r => !r._proprio);
        return [...proprios, ...semProprios];
      });
    } catch (e) {
      console.error('Erro ao carregar dados do paciente:', e);
    } finally {
      setLoading(false);
    }
  }

  async function abrirScanner() {
    const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
    const { status: camStatus } = await ImagePicker.requestCameraPermissionsAsync();
    if (camStatus !== 'granted' && status !== 'granted') {
      Alert.alert('Permissão necessária', 'Precisamos de acesso à câmera para escanear a receita.');
      return;
    }
    Alert.alert('Escanear receita', 'Como você quer enviar a receita?', [
      { text: 'Câmera', onPress: () => capturarImagem('camera') },
      { text: 'Galeria', onPress: () => capturarImagem('library') },
      { text: 'Cancelar', style: 'cancel' },
    ]);
  }

  async function capturarImagem(source) {
    const opts = { mediaTypes: ['images'], allowsEditing: true, quality: 0.7, base64: true };
    let result;
    if (source === 'camera') result = await ImagePicker.launchCameraAsync(opts);
    else result = await ImagePicker.launchImageLibraryAsync(opts);
    if (result.canceled) return;
    analisarReceita(result.assets[0].base64);
  }

  async function analisarReceita(base64) {
    setScanLoading(true);
    try {
      const { data: { session } } = await sb.auth.getSession();
      const token = session?.access_token || SUPABASE_KEY;
      const res = await fetch(`${SUPABASE_URL}/functions/v1/analyze-prescription`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + token },
        body: JSON.stringify({ image: base64 }),
      });
      const rawText = await res.text();
      let lista;
      try { lista = JSON.parse(rawText); } catch(e) { lista = null; }
      if (!Array.isArray(lista) || lista.length === 0 || !lista[0].produto) {
        setScanLoading(false);
        Alert.alert('Não encontrado', 'Não consegui identificar medicamentos nessa imagem. Tente uma foto mais nítida.');
        return;
      }

      const now = Date.now();
      const novasRecs = [];
      for (let i = 0; i < lista.length; i++) {
        const item = lista[i];
        let matchedProduct = { name: item.produto || 'Produto', brand: '', purchase_url: '', category: '' };
        try {
          const palavras = (item.produto || '').split(' ').filter(p => p.length > 2 && !/^\d/.test(p));
          const primeira = palavras[0];
          if (primeira) {
            const { data: dbProds } = await sb.from('products').select('*').ilike('name', `%${primeira}%`).limit(5);
            if (dbProds && dbProds.length > 0) matchedProduct = dbProds.find(p => p.purchase_url) || dbProds[0];
          }
        } catch(e) {}
        novasRecs.push({
          id: 'scan-' + (now + i),
          status: 'not_started',
          dosage: item.dosagem || '',
          frequency: item.frequencia || '',
          duration: item.duracao || '',
          notes: item.observacoes || '',
          products: matchedProduct,
          doctors: { name: 'Receita escaneada' },
          created_at: new Date().toISOString(),
          _scanned: true,
        });
      }
      setScanRecs(prev => [...novasRecs, ...prev]);
      setScanLoading(false);
      Alert.alert('✓ ' + lista.length + ' item' + (lista.length > 1 ? 's encontrados' : ' encontrado'), 'Os produtos foram adicionados à sua lista.');
    } catch(e) {
      setScanLoading(false);
      Alert.alert('Erro', 'Não foi possível analisar a receita. Tente novamente.');
    }
  }

  async function updateStatus(recId, novoStatus, qtdComprimidos = null) {
    if (recId.toString().startsWith('scan-') || recId.toString().startsWith('proprio-')) {
      setScanRecs(prev => prev.map(r => r.id === recId ? { ...r, status: novoStatus } : r));
      // Persiste no AsyncStorage se for próprio
      if (recId.toString().startsWith('proprio-')) {
        const saved = JSON.parse(await AsyncStorage.getItem('prescreve_proprios') || '[]');
        const updated = saved.map(r => r.id === recId ? { ...r, status: novoStatus } : r);
        await AsyncStorage.setItem('prescreve_proprios', JSON.stringify(updated));
      }
      return;
    }
    const updates = { status: novoStatus };
    if (novoStatus === 'active') updates.purchased_at = new Date().toISOString();
    // Atualiza local imediatamente (não espera Supabase)
    setRecs(prev => prev.map(r => r.id === recId ? { ...r, ...updates } : r));
    await sb.from('recommendations').update(updates).eq('id', recId);

    if (novoStatus === 'active') {
      const rec = recs.find(r => r.id === recId);
      if (rec) {
        // Se informou quantidade, usa ela para calcular dias mais precisamente
        const recParaCalculo = qtdComprimidos
          ? { ...rec, _qtdComprimidos: qtdComprimidos }
          : rec;
        const diasAteAcabar = calcDiasRecompra(recParaCalculo);
        if (diasAteAcabar > 0) {
          const dataRecompra = new Date();
          dataRecompra.setDate(dataRecompra.getDate() + diasAteAcabar);
          const nomeProd = rec.products?.name || 'Produto';

          // Agendar notificação de recompra
          const temPermissao = await pedirPermissaoNotificacoes();
          let notifId = null;
          if (temPermissao) {
            notifId = await agendarLembreteRecompra(nomeProd, diasAteAcabar);
          }

          const lembretes = JSON.parse(await AsyncStorage.getItem('prescreve_reminders') || '[]');
          lembretes.push({
            produto: nomeProd,
            tipo: 'Lembrete de recompra',
            hora: '09:00',
            dataRecompra: dataRecompra.toISOString(),
            diasRestantes: diasAteAcabar,
            auto: true,
            notifId,
          });
          await AsyncStorage.setItem('prescreve_reminders', JSON.stringify(lembretes));
        }
      }
    }
  }

  function calcDiasRecompra(rec) {
    // Se tem quantidade de comprimidos, calcula com base na frequência
    if (rec._qtdComprimidos) {
      const freq = (rec.frequency || '').toLowerCase();
      let tomadosPorDia = 1;
      if (/2x|duas vezes|2 vez/i.test(freq)) tomadosPorDia = 2;
      else if (/3x|três vezes|3 vez/i.test(freq)) tomadosPorDia = 3;
      else if (/4x|quatro vezes|4 vez/i.test(freq)) tomadosPorDia = 4;
      const totalDias = Math.floor(rec._qtdComprimidos / tomadosPorDia);
      const antecedencia = Math.min(10, Math.floor(totalDias / 3));
      return Math.max(totalDias - antecedencia, 1);
    }
    // Fallback: calcula pela duração
    const dur = (rec.duration || '').toLowerCase();
    if (!dur) return 0;
    const durMatch = dur.match(/([0-9]+)/);
    if (!durMatch) return 0;
    const durNum = parseInt(durMatch[1]);
    let durDias = durNum;
    if (/m[eê]s/i.test(dur)) durDias = durNum * 30;
    else if (/semana/i.test(dur)) durDias = durNum * 7;
    const antecedencia = Math.min(10, Math.floor(durDias / 3));
    return Math.max(durDias - antecedencia, 1);
  }

  if (loading) {
    return (
      <View style={styles.loadingContainer}>
        <ActivityIndicator color="#1D9E75" size="large" />
      </View>
    );
  }

  // Show health questionnaire on first login
  if (showHealthQuestionnaire && patient) {
    return (
      <HealthQuestionnaire
        patient={patient}
        onComplete={(profile) => {
          patient.health_profile = profile;
          setShowHealthQuestionnaire(false);
        }}
        onSkip={() => setShowHealthQuestionnaire(false)}
      />
    );
  }

  return (
    <SafeAreaView style={styles.safe}>
      <View style={styles.container}>
        <View style={styles.content}>
          {tab === 'inicio' && <TabInicio recs={[...scanRecs, ...recs]} patient={patient} onRefresh={loadData} onScan={abrirScanner} onUpdateStatus={updateStatus} onBula={abrirBula} />}
          {tab === 'receitas' && <TabReceitas recs={[...scanRecs, ...recs]} patient={patient} onUpdateStatus={updateStatus} onLembrete={nome => { setProdutoLembrete(nome); setTab('lembretes'); }} onBula={abrirBula} onAddProprio={() => setShowAddProprio(true)} />}
          {tab === 'lembretes' && <TabLembretes recs={[...scanRecs, ...recs]} produtoInicial={produtoLembrete} onClearProdutoInicial={() => setProdutoLembrete(null)} />}
          {tab === 'dieta' && <TabDieta patient={patient} recs={[...scanRecs, ...recs]} />}
          {tab === 'perfil' && <TabPerfil patient={patient} recs={[...scanRecs, ...recs]} onLogout={onLogout} />}
        </View>

        {/* Modal Adicionar Remédio Próprio */}
        <Modal visible={showAddProprio} animationType="slide" presentationStyle="pageSheet" onRequestClose={() => setShowAddProprio(false)}>
          <SafeAreaView style={{ flex: 1, backgroundColor: '#f5f7f6' }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 20, paddingVertical: 16, backgroundColor: 'white', borderBottomWidth: 1, borderBottomColor: '#f0f0f0' }}>
              <Text style={{ fontSize: 18, fontWeight: '700', color: '#0f1f1a' }}>Adicionar remédio</Text>
              <TouchableOpacity onPress={() => setShowAddProprio(false)} style={{ padding: 4 }}>
                <Ionicons name="close" size={24} color="#666" />
              </TouchableOpacity>
            </View>
            <ScrollView contentContainerStyle={{ padding: 20 }} keyboardShouldPersistTaps="handled">
              <View style={{ backgroundColor: '#e8f5f0', borderRadius: 12, padding: 14, marginBottom: 16, flexDirection: 'row', gap: 10 }}>
                <Ionicons name="information-circle-outline" size={18} color="#1D9E75" />
                <Text style={{ fontSize: 13, color: '#1D9E75', flex: 1, lineHeight: 18 }}>Adicione remédios prescritos fora da plataforma para manter tudo organizado em um lugar só.</Text>
              </View>
              <View style={{ backgroundColor: 'white', borderRadius: 16, padding: 16, marginBottom: 12 }}>
                <Text style={{ fontSize: 12, fontWeight: '600', color: '#888', marginBottom: 4 }}>Nome do remédio *</Text>
                <TextInput style={{ backgroundColor: '#f5f5f5', borderRadius: 10, padding: 12, fontSize: 14, color: '#0f1f1a', marginBottom: 12 }} value={proprioNome} onChangeText={setProprioNome} placeholder="Ex: Vitamina D 2000UI" placeholderTextColor="#999" />
                <Text style={{ fontSize: 12, fontWeight: '600', color: '#888', marginBottom: 4 }}>Médico que prescreveu</Text>
                <TextInput style={{ backgroundColor: '#f5f5f5', borderRadius: 10, padding: 12, fontSize: 14, color: '#0f1f1a', marginBottom: 12 }} value={proprioMedico} onChangeText={setProprioMedico} placeholder="Ex: Dr. João Silva" placeholderTextColor="#999" />
                <View style={{ flexDirection: 'row', gap: 8, marginBottom: 12 }}>
                  <View style={{ flex: 1 }}>
                    <Text style={{ fontSize: 12, fontWeight: '600', color: '#888', marginBottom: 4 }}>Posologia</Text>
                    <TextInput style={{ backgroundColor: '#f5f5f5', borderRadius: 10, padding: 12, fontSize: 14, color: '#0f1f1a' }} value={proprioDosage} onChangeText={setPropriosDosage} placeholder="Ex: 1 cápsula" placeholderTextColor="#999" />
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={{ fontSize: 12, fontWeight: '600', color: '#888', marginBottom: 4 }}>Frequência</Text>
                    <TextInput style={{ backgroundColor: '#f5f5f5', borderRadius: 10, padding: 12, fontSize: 14, color: '#0f1f1a' }} value={proprioFreq} onChangeText={setProprioFreq} placeholder="Ex: 1x ao dia" placeholderTextColor="#999" />
                  </View>
                </View>
                <Text style={{ fontSize: 12, fontWeight: '600', color: '#888', marginBottom: 4 }}>Duração</Text>
                <TextInput style={{ backgroundColor: '#f5f5f5', borderRadius: 10, padding: 12, fontSize: 14, color: '#0f1f1a' }} value={proprioDur} onChangeText={setPropriosDur} placeholder="Ex: 3 meses" placeholderTextColor="#999" />
              </View>
              <TouchableOpacity style={{ backgroundColor: '#1D9E75', borderRadius: 14, padding: 16, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8 }} onPress={salvarProprio}>
                <Ionicons name="checkmark-circle-outline" size={18} color="white" />
                <Text style={{ color: 'white', fontWeight: '700', fontSize: 16 }}>Salvar</Text>
              </TouchableOpacity>
            </ScrollView>
          </SafeAreaView>
        </Modal>

        {/* Modal Bula */}
        <Modal visible={bulaModal.visible} transparent animationType="slide" onRequestClose={() => setBulaModal(p => ({ ...p, visible: false }))}>
          <View style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'flex-end' }}>
            <View style={{ backgroundColor: 'white', borderTopLeftRadius: 20, borderTopRightRadius: 20, maxHeight: '80%' }}>
              <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', padding: 20, borderBottomWidth: 1, borderBottomColor: '#f0f0f0' }}>
                <View>
                  <Text style={{ fontSize: 16, fontWeight: '700', color: '#0f1f1a' }}>{bulaModal.nome}</Text>
                  {bulaModal.marca ? <Text style={{ fontSize: 12, color: '#888', marginTop: 2 }}>{bulaModal.marca}</Text> : null}
                </View>
                <TouchableOpacity onPress={() => setBulaModal(p => ({ ...p, visible: false }))} style={{ padding: 8 }}>
                  <Ionicons name="close" size={22} color="#666" />
                </TouchableOpacity>
              </View>
              <ScrollView contentContainerStyle={{ padding: 20 }}>
                {bulaModal.loading
                  ? <View style={{ alignItems: 'center', paddingVertical: 40 }}><ActivityIndicator color="#1D9E75" size="large" /><Text style={{ marginTop: 12, color: '#888', fontSize: 13 }}>Carregando bula...</Text></View>
                  : <>
                      <View style={{ backgroundColor: '#fff8e1', borderRadius: 8, padding: 10, marginBottom: 14, flexDirection: 'row', alignItems: 'flex-start', gap: 6 }}>
                        <Text style={{ fontSize: 13 }}>⚠️</Text>
                        <Text style={{ fontSize: 12, color: '#7a5c00', lineHeight: 18, flex: 1 }}>Esta bula foi resumida por Inteligência Artificial e pode conter imprecisões. Consulte sempre a bula original e seu médico ou farmacêutico antes de usar qualquer medicamento.</Text>
                      </View>
                      <Text style={{ fontSize: 14, color: '#333', lineHeight: 22 }}>{bulaModal.texto}</Text>
                    </>
                }
              </ScrollView>
            </View>
          </View>
        </Modal>

        <Modal visible={scanLoading} transparent animationType="fade">
          <View style={styles.scanModal}>
            <View style={styles.scanModalBox}>
              <ActivityIndicator color="#1D9E75" size="large" />
              <Text style={styles.scanModalText}>Analisando receita...</Text>
              <Text style={styles.scanModalSub}>Identificando medicamentos</Text>
            </View>
          </View>
        </Modal>

        <View style={styles.bottomNav}>
          {TABS.map(t => (
            <TouchableOpacity key={t.key} style={styles.navItem} onPress={() => setTab(t.key)} activeOpacity={0.7}>
              <Ionicons name={tab === t.key ? t.iconActive : t.icon} size={22} color={tab === t.key ? '#1D9E75' : '#9aaca8'} />
              <Text style={[styles.navLabel, tab === t.key && styles.navLabelActive]}>{t.label}</Text>
              {tab === t.key && <View style={styles.navIndicator} />}
            </TouchableOpacity>
          ))}
        </View>
      </View>
    </SafeAreaView>
  );
}

// ─── CARD DE PRODUTO ──────────────────────────────────────────────────────────
async function gerarReceitaPDF(rec, patientName = '') {
  try {
    const manip = parseManipulado(rec.notes);
    if (!manip) return;
    const docName = rec.doctors?.name || 'Médico';
    const patName = patientName || '';
    const docId = rec.doctor_id;
    const date = new Date().toLocaleDateString('pt-BR');
    const hasTitle = /^dr\.?\s|^dra\.?\s/i.test(docName.trim());
    const title = hasTitle ? docName : 'Dr. ' + docName;

    let logoUrl = null, assinaturaUrl = null, specialty = '', crm = '';
    if (docId) {
      const { data } = await sb.from('doctors').select('logo_url,assinatura_url,specialty,crm').eq('id', docId).single();
      if (data) { logoUrl = data.logo_url; assinaturaUrl = data.assinatura_url; specialty = data.specialty||''; crm = data.crm||''; }
    }

    const comps = (manip.componentes||[]).map(c =>
      `<tr><td style="padding:6px 12px;border-bottom:1px solid #eee;">${c.nome}</td><td style="padding:6px 12px;border-bottom:1px solid #eee;font-weight:600;color:#2d5a50;">${c.conc||''}</td></tr>`
    ).join('');

    const headerHtml = logoUrl
      ? `<div style="display:flex;align-items:center;justify-content:space-between;border-bottom:2px solid #1D9E75;padding-bottom:14px;margin-bottom:20px;"><img src="${logoUrl}" style="max-height:60px;max-width:160px;object-fit:contain;"><div style="text-align:right;"><div style="font-size:13px;font-weight:700;">${title}</div>${specialty ? `<div style="font-size:12px;color:#666;">${specialty}</div>` : ''}${crm ? `<div style="font-size:11px;color:#888;">CRM ${crm}</div>` : ''}</div></div>`
      : `<div style="font-size:22px;font-weight:700;color:#1D9E75;border-bottom:2px solid #1D9E75;padding-bottom:12px;margin-bottom:20px;">synka</div><p style="font-size:13px;color:#666;">${title}${specialty ? ' · '+specialty : ''}${crm ? ' · CRM '+crm : ''}</p>`;

    const assinaturaHtml = assinaturaUrl
      ? `<div style="margin-top:32px;border-top:1px solid #eee;padding-top:16px;"><img src="${assinaturaUrl}" style="max-height:70px;object-fit:contain;"><div style="font-size:12px;color:#555;margin-top:4px;">${title}${crm ? ' · CRM '+crm : ''}</div></div>`
      : '';

    const html = `<!DOCTYPE html><html><head><meta charset="UTF-8"><style>body{font-family:Georgia,serif;max-width:600px;margin:40px auto;color:#1a1a1a;padding:20px;}table{width:100%;border-collapse:collapse;margin-bottom:16px;}th{background:#e8f2ef;padding:8px 12px;text-align:left;font-size:12px;text-transform:uppercase;color:#1D9E75;}.ib{display:inline-block;background:#f4f7f6;border-radius:8px;padding:8px 14px;margin:4px;font-size:13px;}.ib b{display:block;font-size:11px;color:#888;text-transform:uppercase;}.foot{margin-top:32px;border-top:1px solid #eee;padding-top:12px;font-size:11px;color:#888;text-align:center;}</style></head><body>${headerHtml}<p style="font-size:13px;color:#666;margin-bottom:4px;">${date}</p><h2 style="color:#2d5a50;margin-bottom:4px;">${manip.nome||'Fórmula manipulada'}</h2><p style="font-size:13px;color:#666;margin-bottom:16px;">Paciente: <strong>${patName}</strong></p><table><thead><tr><th>Componente</th><th>Concentração</th></tr></thead><tbody>${comps}</tbody></table>${manip.veiculo ? `<div class="ib"><b>Veículo</b>${manip.veiculo}</div>` : ''}${manip.qtd ? `<div class="ib"><b>Quantidade</b>${manip.qtd}</div>` : ''}${assinaturaHtml}<div class="foot">Gerado via synka · synkasaude.com.br · ${date}</div></body></html>`;

    const { uri } = await Print.printToFileAsync({ html, base64: false });
    if (await Sharing.isAvailableAsync()) {
      await Sharing.shareAsync(uri, { mimeType: 'application/pdf', dialogTitle: 'Receita ' + (manip.nome||'manipulado') });
    } else {
      Alert.alert('PDF gerado', 'Arquivo salvo em: ' + uri);
    }
  } catch(e) {
    Alert.alert('Erro', 'Não foi possível gerar o PDF.');
  }
}

function ProdutoCard({ rec, showBuyBtn, onUpdateStatus, onLembrete, onBula, patient }) {
  const [showFarmacias, setShowFarmacias] = useState(false);
  const [showModalQuantidade, setShowModalQuantidade] = useState(false);
  const [qtdComprimidos, setQtdComprimidos] = useState('');
  const [showModalConcluido, setShowModalConcluido] = useState(false);
  const [showCotacoes, setShowCotacoes] = useState(false);
  const [cotacoes, setCotacoes] = useState([]);
  const [loadingCotacoes, setLoadingCotacoes] = useState(false);
  const [showPagamento, setShowPagamento] = useState(false);
  const [cotacaoSelecionada, setCotacaoSelecionada] = useState(null);
  const [processandoPagamento, setProcessandoPagamento] = useState(false);
  const [metodoPagamento, setMetodoPagamento] = useState('pix');
  const [pixQrCode, setPixQrCode] = useState(null);
  const pollingRef = useRef(null);
  const manip = parseManipulado(rec.notes);
  const p = rec.products;

  useEffect(() => {
    if (!manip || !rec.id) return;
    let cancelled = false;
    async function loadCotacoes() {
      try {
        const { data } = await sb.from('cotacoes')
          .select('*')
          .eq('recommendation_id', rec.id)
          .order('created_at', { ascending: false });
        if (!cancelled && data) setCotacoes(data);
      } catch(e) {}
    }
    if (showCotacoes) {
      loadCotacoes();
      pollingRef.current = setInterval(() => {
        if (!cancelled) loadCotacoes();
      }, 3000);
    } else {
      if (pollingRef.current) {
        clearInterval(pollingRef.current);
        pollingRef.current = null;
      }
    }
    return () => {
      cancelled = true;
      if (pollingRef.current) {
        clearInterval(pollingRef.current);
        pollingRef.current = null;
      }
    };
  }, [rec.id, manip, showCotacoes]);

  async function solicitarOrcamento() {
    setLoadingCotacoes(true);
    try {
      const { data: { session } } = await sb.auth.getSession();
      const token = session?.access_token || SUPABASE_KEY;
      await fetch('https://iwrfgdfxvyqdkqdtrrxg.supabase.co/functions/v1/solicitar-cotacao', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + token },
        body: JSON.stringify({ recommendation_id: rec.id }),
      });
      const { data } = await sb.from('cotacoes')
        .select('*')
        .eq('recommendation_id', rec.id)
        .order('created_at', { ascending: false });
      if (data) setCotacoes(data);
      Alert.alert('✓ Solicitação enviada!', 'As farmácias parceiras foram notificadas e responderão em breve.');
    } catch(e) {}
    setLoadingCotacoes(false);
  }

  function handleJaComprei() {
    setQtdComprimidos('');
    setShowModalQuantidade(true);
  }

  async function confirmarCompra() {
    setShowModalQuantidade(false);
    onUpdateStatus(rec.id, 'active', qtdComprimidos ? parseInt(qtdComprimidos) : null);

    // Adiciona automaticamente ao armário
    try {
      const norm = str => (str || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
      const CATEGORIAS = {
          'Estômago': ['bromoprida','omeprazol','pantoprazol','metoclopramida','domperidona','ranitidina','buscopan','dimeticona','loperamida'],
          'Dor & Febre': ['dipirona','paracetamol','ibuprofeno','aspirina','nimesulida','naproxeno','diclofenaco','tramadol'],
          'Alergia': ['loratadina','cetirizina','fexofenadina','desloratadina','hidroxizina'],
          'Antibióticos': ['amoxicilina','azitromicina','ciprofloxacino','cefalexina','clindamicina','metronidazol'],
          'Vitaminas': ['vitamina','omega','zinco','magnesio','ferro','calcio','biotina','suplemento'],
          'Pressão & Coração': ['losartana','enalapril','anlodipino','atenolol','metoprolol','sinvastatina','atorvastatina'],
          'Ansiedade & Sono': ['clonazepam','alprazolam','diazepam','zolpidem','lorazepam','rivotril'],
          'Respiratório': ['salbutamol','budesonida','montelucaste','prednisona','ambroxol','acetilcisteina'],
        };
        const nLower = norm(p?.name || '');
        let categoria = 'Outros';
        for (const [cat, termos] of Object.entries(CATEGORIAS)) {
          if (termos.some(t => nLower.includes(t))) { categoria = cat; break; }
        }
        await sb.from('armario').insert({
          patient_id: patient?.id || null,
          nome: p?.name || 'Medicamento',
          dosagem: rec.dosage || '',
          quantidade: qtdComprimidos ? parseInt(qtdComprimidos) : null,
          unidade_quantidade: 'comprimidos',
          categoria,
        });
    } catch(e) {}
  }

  function handleConcluido() {
    if (rec.doctors?.whatsapp) {
      setShowModalConcluido(true);
    } else {
      onUpdateStatus(rec.id, 'completed');
    }
  }

  function confirmarConcluido(avisarMedico) {
    setShowModalConcluido(false);
    onUpdateStatus(rec.id, 'completed');
    if (avisarMedico && rec.doctors?.whatsapp) {
      const nomeProd = rec.products?.name || 'o tratamento';
      const nomeMedico = rec.doctors.name?.split(' ')[0] || '';
      const msg = 'Olá Dr(a). ' + nomeMedico + '! Terminei o tratamento de ' + nomeProd + '. Tudo correu bem! Obrigado(a).';
      const num = rec.doctors.whatsapp.replace(/\D/g, '');
      const numBR = num.startsWith('55') ? num : '55' + num;
      Linking.openURL('https://wa.me/' + numBR + '?text=' + encodeURIComponent(msg)).catch(() => {});
    }
  }

  const FARMACIAS_LISTA = (nome, url) => [
    ...(url ? [{ nome: 'Recomendado', url, destaque: true }] : []),
    { nome: 'Ultrafarma', url: `https://www.ultrafarma.com.br/busca?q=${encodeURIComponent(nome)}` },
    { nome: 'Droga Raia', url: `https://www.drogaraia.com.br/search?w=${encodeURIComponent(nome)}` },
    { nome: 'Drogasil', url: `https://www.drogasil.com.br/search?w=${encodeURIComponent(nome)}` },
    { nome: 'Panvel', url: `https://www.panvel.com/busca?q=${encodeURIComponent(nome)}` },
    { nome: 'São João', url: `https://www.drogariasaojoao.com.br/catalogsearch/result/?q=${encodeURIComponent(nome)}` },
    { nome: 'Pague Menos', url: `https://www.paguemenos.com.br/busca?q=${encodeURIComponent(nome)}` },
  ];

  function abrirCompra(url) {
    Linking.openURL(url).catch(() => Alert.alert('Não foi possível abrir o link'));
  }

  const MARCAS_BUSCA = [
    { chaves: ['nutrify'],                                        fn: q => { var s=q.toLowerCase().replace(/\s+/g,'-'); return 'https://www.nutrify.com.br/'+s+'?_q='+encodeURIComponent(q)+'&map=ft'; } },
    { chaves: ['maxtitanium','max titanium','max-titanium'],      fn: q => { var s=q.toLowerCase().replace(/\s+/g,'-'); return 'https://www.maxtitanium.com.br/'+s+'?_q='+encodeURIComponent(q)+'&map=ft'; } },
    { chaves: ['darkness'],                                       fn: q => 'https://www.darkness.com.br/search?q='+encodeURIComponent(q) },
    { chaves: ['growth','gsuplementos'],                          fn: q => 'https://www.gsuplementos.com.br/busca?q='+encodeURIComponent(q) },
    { chaves: ['integral medica','integralmedica','integral médica'], fn: q => 'https://www.integralmedica.com.br/busca?q='+encodeURIComponent(q) },
    { chaves: ['probiotica','probiótica'],                        fn: q => 'https://www.probiotica.com.br/busca?q='+encodeURIComponent(q) },
    { chaves: ['midway','midwaylabs'],                            fn: q => 'https://www.midwaylabs.com.br/busca?q='+encodeURIComponent(q) },
    { chaves: ['black skull','blackskull'],                       fn: q => 'https://www.blackskull.com.br/busca?q='+encodeURIComponent(q) },
    { chaves: ['dux','dux nutrition'],                            fn: q => 'https://www.duxnutrition.com.br/busca?q='+encodeURIComponent(q) },
    { chaves: ['body action','bodyaction'],                       fn: q => 'https://www.bodyaction.com.br/busca?q='+encodeURIComponent(q) },
    { chaves: ['atlhetica','atlhética'],                          fn: q => 'https://www.atlhetica.com.br/busca?q='+encodeURIComponent(q) },
    { chaves: ['vitafor'],                                        fn: q => 'https://www.vitafor.com.br/busca?q='+encodeURIComponent(q) },
    { chaves: ['pura vida','puravida'],                           fn: q => 'https://www.puravida.com.br/busca?q='+encodeURIComponent(q) },
    { chaves: ['equaliv'],                                        fn: q => 'https://www.equaliv.com.br/busca?q='+encodeURIComponent(q) },
    { chaves: ['new millen','newmillen'],                         fn: q => 'https://www.newmillen.com.br/busca?q='+encodeURIComponent(q) },
    { chaves: ['optimum nutrition','optimum'],                    fn: q => 'https://www.optimumnutrition.com/pt-br/search#q='+encodeURIComponent(q) },
    { chaves: ['universal'],                                      fn: q => 'https://www.universal.com.br/busca?q='+encodeURIComponent(q) },
    { chaves: ['adaptogen'],                                      fn: q => 'https://www.adaptogen.com.br/busca?q='+encodeURIComponent(q) },
    { chaves: ['underlabz','under labz'],                         fn: q => 'https://www.underlabz.com.br/busca?q='+encodeURIComponent(q) },
    { chaves: ['ftw'],                                            fn: q => 'https://www.ftw.com.br/busca?q='+encodeURIComponent(q) },
    { chaves: ['now foods','nowfoods'],                           fn: q => 'https://www.nowfoods.com.br/busca?q='+encodeURIComponent(q) },
  ];

  function buildBrandSearchUrl(siteUrl, productName, brandName) {
    if (siteUrl && /^https?:\/\/.+=\s*$/.test(siteUrl)) return siteUrl + encodeURIComponent(productName);
    if (siteUrl && /^https?:\/\/.+\?.+=.+/.test(siteUrl)) return siteUrl;
    const nomeNorm = (brandName || '').toLowerCase();
    const marca = MARCAS_BUSCA.find(m => m.chaves.some(c => nomeNorm.includes(c)));
    if (marca) return marca.fn(productName);
    const q = [productName, brandName].filter(Boolean).join(' ');
    return 'https://www.google.com/search?q=' + encodeURIComponent(q);
  }

  function statusInfo() {
    if (rec.status === 'active') return { label: 'Em uso', cor: '#1D9E75', bg: '#e8f5f0' };
    if (rec.status === 'completed') return { label: 'Concluído', cor: '#999', bg: '#f0f0f0' };
    return { label: 'Pendente', cor: '#888', bg: '#f5f5f5' };
  }

  function formatDataSutil(d) {
    if (!d) return '';
    const data = new Date(d);
    const hoje = new Date();
    const diff = Math.round((hoje - data) / 86400000);
    if (diff === 0) return 'hoje';
    if (diff === 1) return 'ontem';
    if (diff < 7) return `há ${diff} dias`;
    return data.toLocaleDateString('pt-BR', { day: '2-digit', month: 'short' });
  }

  const st = statusInfo();
  const medico = rec.doctors?.name ? `Dr(a). ${rec.doctors.name.split(' ').slice(0, 2).join(' ')}` : '';

  // Verifica se paciente tem remédio similar no armário
  const [armarioSimilar, setArmarioSimilar] = useState(null);
  useEffect(() => {
    if (!p?.name || manip) return;
    async function checkArmario() {
      try {
        if (!patient?.id) return;
        const { data } = await sb.from('armario').select('*').eq('patient_id', patient.id);
        if (!data || data.length === 0) return;
        // Normaliza texto removendo acentos para comparação
        const norm = str => str.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
        const partesPrescrito = norm(p.name || '').split(' ').filter(w => w.length > 2);
        const nomePrescrito = partesPrescrito.slice(0, 2).join(' ') || partesPrescrito[0] || '';
        const similar = data.find(a => {
          const nomeArm = norm(a.nome || '');
          const partesArm = nomeArm.split(' ').filter(w => w.length > 2);
          // Match exato das 2 primeiras palavras, ou match bidirecional completo
          const prescNorm = norm(p.name || '');
          return nomeArm === prescNorm || 
                 (nomePrescrito.length > 4 && nomeArm.includes(nomePrescrito)) ||
                 (nomePrescrito.length > 4 && nomePrescrito.includes(partesArm.slice(0,2).join(' ')));
        });
        if (similar) setArmarioSimilar(similar);
      } catch(e) {}
    }
    checkArmario();
  }, [p?.name]);
  const dataSutil = formatDataSutil(rec.created_at);
  const nomeProduto = manip ? (manip.nome || 'Fórmula manipulada') : (p?.name || 'Produto');
  const farmacias = FARMACIAS_LISTA(p?.name || '', p?.purchase_url || '');

  return (
    <View style={[styles.produtoCard, manip && styles.produtoCardManip]}>
      <View style={styles.produtoCardHeader}>
        <View style={styles.produtoCardInfo}>
          {manip && <Text style={styles.manipBadge}>Manipulado</Text>}
          <Text style={styles.produtoCardNome}>{nomeProduto}</Text>
          <View style={styles.produtoCardMeta}>
            {medico ? <Text style={styles.produtoCardMedico}>{medico}</Text> : null}
            {dataSutil ? <Text style={styles.produtoCardData}> · {dataSutil}</Text> : null}
          </View>
        </View>
        <View style={[styles.statusBadge, { backgroundColor: st.bg }]}>
          <Text style={[styles.statusBadgeText, { color: st.cor }]}>{st.label}</Text>
        </View>
      </View>

      {!manip && (rec.dosage || rec.frequency || rec.duration) ? (
        <View style={styles.produtoCardDetalhes}>
          {rec.dosage ? <Text style={styles.produtoCardDetalhe}>{rec.dosage}</Text> : null}
          {rec.frequency ? <Text style={styles.produtoCardDetalhe}>{rec.frequency}</Text> : null}
          {rec.duration ? <Text style={styles.produtoCardDetalhe}>{rec.duration}</Text> : null}
        </View>
      ) : null}

      {!manip && rec.notes ? (
        <Text style={{ fontSize: 12, color: '#888', fontStyle: 'italic', marginTop: 6, marginHorizontal: 2 }}>"{rec.notes}"</Text>
      ) : null}

      {manip && (
        <View style={styles.manipBox}>
          {(manip.componentes || []).length > 0 && (
            <View style={styles.manipComps}>
              <View style={{ flexDirection: 'row', paddingBottom: 4, borderBottomWidth: 1, borderBottomColor: '#e8f5f0', marginBottom: 4 }}>
                <Text style={{ flex: 1, fontSize: 11, fontWeight: '700', color: '#1D9E75', textTransform: 'uppercase' }}>Componente</Text>
                <Text style={{ fontSize: 11, fontWeight: '700', color: '#1D9E75', textTransform: 'uppercase' }}>Conc.</Text>
              </View>
              {manip.componentes.map((c, i) => (
                <View key={i} style={[styles.manipCompRow, { borderBottomWidth: i < manip.componentes.length - 1 ? 1 : 0, borderBottomColor: '#f5f5f5' }]}>
                  <Text style={[styles.manipCompNome, { flex: 1 }]}>{c.nome}</Text>
                  {c.conc ? <Text style={styles.manipCompConc}>{c.conc}</Text> : null}
                </View>
              ))}
            </View>
          )}
          {(manip.veiculo || manip.qtd || manip.dosage || rec.dosage || manip.frequency || rec.frequency || manip.duration || rec.duration) && (
            <View style={{ marginTop: 10, borderRadius: 10, overflow: 'hidden', borderWidth: 1, borderColor: '#e8f5f0' }}>
              {manip.veiculo ? <View style={styles.manipTabelaRow}><Text style={styles.manipTabelaLabel}>Veículo</Text><Text style={styles.manipTabelaValor}>{manip.veiculo}</Text></View> : null}
              {manip.qtd ? <View style={[styles.manipTabelaRow, { backgroundColor: '#f9fdfc' }]}><Text style={styles.manipTabelaLabel}>Quantidade</Text><Text style={styles.manipTabelaValor}>{manip.qtd}</Text></View> : null}
              {(manip.dosage || rec.dosage) ? <View style={styles.manipTabelaRow}><Text style={styles.manipTabelaLabel}>Posologia</Text><Text style={styles.manipTabelaValor}>{manip.dosage || rec.dosage}</Text></View> : null}
              {(manip.frequency || rec.frequency) ? <View style={[styles.manipTabelaRow, { backgroundColor: '#f9fdfc' }]}><Text style={styles.manipTabelaLabel}>Frequência</Text><Text style={styles.manipTabelaValor}>{manip.frequency || rec.frequency}</Text></View> : null}
              {(manip.duration || rec.duration) ? <View style={styles.manipTabelaRow}><Text style={styles.manipTabelaLabel}>Duração</Text><Text style={styles.manipTabelaValor}>{manip.duration || rec.duration}</Text></View> : null}
            </View>
          )}
          {manip.notes ? <Text style={{ fontSize: 12, color: '#888', fontStyle: 'italic', marginTop: 8 }}>"{manip.notes}"</Text> : null}
          {manip.farmacia && <Text style={styles.manipFarmacia}>Farmácia: {manip.farmacia}</Text>}
        </View>
      )}

      {showBuyBtn && rec.status !== 'completed' && p && !manip && (
        <>
          {armarioSimilar && (
            <View style={{ marginTop: 10, marginBottom: 4, backgroundColor: '#f0f7ff', borderRadius: 10, padding: 12, borderLeftWidth: 3, borderLeftColor: '#3b82f6' }}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 3 }}>
                <Ionicons name="home-outline" size={14} color="#3b82f6" />
                <Text style={{ fontSize: 12, fontWeight: '700', color: '#1e40af' }}>Você já possui este medicamento</Text>
              </View>
              <Text style={{ fontSize: 11, color: '#1e40af', lineHeight: 16 }}>
                Encontramos <Text style={{ fontWeight: '700' }}>{armarioSimilar.nome}</Text> no seu armário{armarioSimilar.quantidade ? ` — ${armarioSimilar.quantidade} ${armarioSimilar.unidade_quantidade} disponíveis` : ''}. Consulte seu médico antes de iniciar.
              </Text>
            </View>
          )}
          <View style={styles.produtoCardAcoes}>
            {rec.status !== 'active' && onUpdateStatus && (
              <TouchableOpacity style={styles.btnEmUso} onPress={handleJaComprei}>
                <Text style={styles.btnEmUsoText}>Já comprei</Text>
              </TouchableOpacity>
            )}
            <TouchableOpacity style={styles.btnComprar} onPress={() => setShowFarmacias(!showFarmacias)}>
              <Ionicons name="cart-outline" size={15} color="white" style={{ marginRight: 5 }} />
              <Text style={styles.btnComprarText}>Comprar agora</Text>
            </TouchableOpacity>
          </View>

          {showFarmacias && (
            <View style={{ marginTop: 12 }}>
              {rec.marcas_sugeridas?.length > 0 && (
                <>
                  <Text style={{ fontSize: 11, fontWeight: '700', color: '#1D9E75', textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 8 }}>Marcas sugeridas pelo seu médico</Text>
                  {rec.marcas_sugeridas.map((m, i) => (
                    <TouchableOpacity key={i} onPress={() => Linking.openURL(buildBrandSearchUrl(m.site_url, p?.name, m.nome)).catch(() => {})}
                      style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', backgroundColor: 'white', borderRadius: 12, padding: 12, marginBottom: 8, borderWidth: 1.5, borderColor: '#e8f5f0' }}
                    >
                      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
                        <View style={{ width: 36, height: 36, backgroundColor: '#e8f5f0', borderRadius: 8, alignItems: 'center', justifyContent: 'center' }}>
                          <Text style={{ fontSize: 14, fontWeight: '700', color: '#1D9E75' }}>{m.nome.charAt(0)}</Text>
                        </View>
                        <Text style={{ fontSize: 14, fontWeight: '600', color: '#0f1f1a' }}>{m.nome}</Text>
                      </View>
                      <View style={{ backgroundColor: '#e8f5f0', paddingHorizontal: 10, paddingVertical: 4, borderRadius: 20 }}>
                        <Text style={{ fontSize: 12, color: '#1D9E75', fontWeight: '700' }}>Ver →</Text>
                      </View>
                    </TouchableOpacity>
                  ))}
                  <View style={{ height: 1, backgroundColor: '#f0f0f0', marginVertical: 8 }} />
                </>
              )}
              <Text style={{ fontSize: 11, fontWeight: '700', color: '#888', textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 8 }}>Farmácias</Text>
              <View style={styles.farmaciasBox}>
                {farmacias.map(f => (
                  <TouchableOpacity key={f.nome} style={[styles.farmaciaBtn, f.destaque && styles.farmaciaBtnDestaque]} onPress={() => abrirCompra(f.url)}>
                    <Text style={[styles.farmaciaBtnText, f.destaque && styles.farmaciaBtnTextDestaque]}>{f.nome}</Text>
                  </TouchableOpacity>
                ))}
              </View>
            </View>
          )}

          {rec.status === 'active' && (
            <View style={styles.produtoCardAcoesSecundarias}>
              {onUpdateStatus && (
                <TouchableOpacity onPress={handleConcluido} style={styles.btnAcaoSecundaria}>
                  <Ionicons name="checkmark-circle-outline" size={15} color="#bbb" />
                  <Text style={styles.btnAcaoSecundariaText}>Concluído</Text>
                </TouchableOpacity>
              )}
              {onLembrete && (
                <>
                  <View style={styles.btnAcaoSeparador} />
                  <TouchableOpacity onPress={() => onLembrete(p.name)} style={styles.btnAcaoSecundaria}>
                    <Ionicons name="notifications-outline" size={15} color="#1D9E75" />
                    <Text style={[styles.btnAcaoSecundariaText, { color: '#1D9E75' }]}>Lembrete</Text>
                  </TouchableOpacity>
                </>
              )}
            </View>
          )}
        </>
      )}

      {p && onBula && (
        <View style={{ marginTop: 8, paddingTop: 8, borderTopWidth: 1, borderTopColor: '#f5f5f5' }}>
          <TouchableOpacity onPress={() => onBula(p.name, p.brand || '')} style={styles.btnAcaoSecundaria}>
            <Ionicons name="document-text-outline" size={15} color="#888" />
            <Text style={styles.btnAcaoSecundariaText}>Ver bula</Text>
          </TouchableOpacity>
        </View>
      )}

      {rec.status === 'active' && (() => {
        const _manipNome = parseManipulado(rec.notes)?.nome || null;
      const inicio = new Date(rec.purchased_at || rec.created_at);
        const dur = (rec.duration || '').toLowerCase();
        const m = dur.match(/([0-9]+)/);
        const temDuracao = !!m;
        const totalDias = temDuracao ? (() => { const n = parseInt(m[1]); if (/m[eê]s/i.test(dur)) return n * 30; if (/semana/i.test(dur)) return n * 7; return n; })() : 0;
        const passados = temDuracao ? Math.min(Math.floor((new Date() - inicio) / 86400000), totalDias) : Math.floor((new Date() - inicio) / 86400000);
        const restam = temDuracao ? Math.max(totalDias - passados, 0) : null;
        const pct = temDuracao ? Math.round((passados / totalDias) * 100) : 0;
        const urgente = temDuracao && pct >= 70;
        const fimData = temDuracao ? (() => { const d = new Date(inicio); d.setDate(d.getDate() + totalDias); return d; })() : null;
        return (
          <View style={{ marginTop: 12, paddingTop: 12, borderTopWidth: 1, borderTopColor: '#f0f0f0' }}>
            {temDuracao && (
              <View style={{ flexDirection: 'row', gap: 8, marginBottom: 10 }}>
                <View style={{ flex: 1, backgroundColor: '#f5f7f6', borderRadius: 10, padding: 10, alignItems: 'center' }}>
                  <Text style={{ fontSize: 18, fontWeight: '700', color: '#0f1f1a' }}>{passados}</Text>
                  <Text style={{ fontSize: 10, color: '#888', marginTop: 2 }}>dias feitos</Text>
                </View>
                <View style={{ flex: 1, backgroundColor: urgente ? '#fff0f0' : '#f5f7f6', borderRadius: 10, padding: 10, alignItems: 'center' }}>
                  <Text style={{ fontSize: 18, fontWeight: '700', color: urgente ? '#e05555' : '#0f1f1a' }}>{restam}</Text>
                  <Text style={{ fontSize: 10, color: urgente ? '#e05555' : '#888', marginTop: 2 }}>dias restantes</Text>
                </View>
                <View style={{ flex: 1, backgroundColor: pct >= 100 ? '#e8f5f0' : '#f5f7f6', borderRadius: 10, padding: 10, alignItems: 'center' }}>
                  <Text style={{ fontSize: 18, fontWeight: '700', color: pct >= 100 ? '#1D9E75' : '#0f1f1a' }}>{pct}%</Text>
                  <Text style={{ fontSize: 10, color: '#888', marginTop: 2 }}>concluído</Text>
                </View>
              </View>
            )}
            <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginBottom: 4 }}>
              <Text style={{ fontSize: 10, color: '#bbb' }}>{inicio.toLocaleDateString('pt-BR', { day: '2-digit', month: 'short' })}</Text>
              {fimData && <Text style={{ fontSize: 10, color: urgente ? '#e05555' : '#bbb' }}>{fimData.toLocaleDateString('pt-BR', { day: '2-digit', month: 'short' })}</Text>}
              {!temDuracao && <Text style={{ fontSize: 10, color: '#888' }}>Dia {passados} em uso</Text>}
            </View>
            <View style={{ height: 6, backgroundColor: '#f0f0f0', borderRadius: 3, overflow: 'hidden' }}>
              <View style={{ width: (temDuracao ? pct : 100) + '%', height: 6, backgroundColor: urgente ? '#e05555' : '#1D9E75', borderRadius: 3 }} />
            </View>
          </View>
        );
      })()}

      {manip && rec.status !== 'completed' && (
        <View style={{ marginTop: 12 }}>
          <TouchableOpacity
            style={{ backgroundColor: '#6366f1', borderRadius: 12, padding: 12, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8 }}
            onPress={() => setShowCotacoes(true)}
          >
            <Ionicons name="storefront-outline" size={16} color="white" />
            <Text style={{ color: 'white', fontWeight: '700', fontSize: 14 }}>
              Ver orçamentos {cotacoes.length > 0 ? '(' + cotacoes.length + ')' : ''}
            </Text>
          </TouchableOpacity>
          <Text style={{ fontSize: 10, color: '#aaa', textAlign: 'center', marginTop: 6 }}>
            Você precisará apresentar a receita médica na farmácia
          </Text>
        </View>
      )}

      {/* Modal de Cotações */}
      <Modal visible={showCotacoes} animationType="slide" presentationStyle="pageSheet" onRequestClose={() => setShowCotacoes(false)}>
        <SafeAreaView style={{ flex: 1, backgroundColor: '#f5f7f6' }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 20, paddingVertical: 16, backgroundColor: 'white', borderBottomWidth: 1, borderBottomColor: '#f0f0f0' }}>
            <View>
              <Text style={{ fontSize: 17, fontWeight: '700', color: '#0f1f1a' }}>Orçamentos</Text>
              <Text style={{ fontSize: 12, color: '#999', marginTop: 2 }}>{manip?.nome || 'Fórmula manipulada'}</Text>
            </View>
            <TouchableOpacity onPress={() => setShowCotacoes(false)} style={{ padding: 4 }}>
              <Ionicons name="close" size={24} color="#666" />
            </TouchableOpacity>
          </View>

          <ScrollView contentContainerStyle={{ padding: 20 }}>
            {/* Componentes da fórmula */}
            {(manip?.componentes || []).length > 0 && (
              <View style={{ backgroundColor: 'white', borderRadius: 14, padding: 14, marginBottom: 16 }}>
                <Text style={{ fontSize: 12, fontWeight: '700', color: '#6366f1', textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 8 }}>Fórmula</Text>
                {manip.componentes.map((c, i) => (
                  <View key={i} style={{ flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 4, borderBottomWidth: i < manip.componentes.length - 1 ? 0.5 : 0, borderBottomColor: '#f0f0f0' }}>
                    <Text style={{ fontSize: 13, color: '#333' }}>{c.nome}</Text>
                    {c.conc ? <Text style={{ fontSize: 13, color: '#6366f1', fontWeight: '600' }}>{c.conc}</Text> : null}
                  </View>
                ))}
                {manip.veiculo ? <Text style={{ fontSize: 11, color: '#999', marginTop: 8 }}>Veículo: {manip.veiculo} · {manip.qtd || ''}</Text> : null}
              </View>
            )}

            {/* Aviso de receita */}
            <View style={{ backgroundColor: '#fff7e6', borderRadius: 12, padding: 12, marginBottom: 16, flexDirection: 'row', gap: 8 }}>
              <Ionicons name="information-circle-outline" size={16} color="#f59e0b" style={{ marginTop: 1 }} />
              <Text style={{ fontSize: 12, color: '#92400e', flex: 1, lineHeight: 17 }}>
                Você precisará apresentar a receita médica original na farmácia para retirar o manipulado.
              </Text>
            </View>

            {/* Farmácias parceiras */}
            {cotacoes.length === 0 ? (
              <View style={{ backgroundColor: 'white', borderRadius: 14, padding: 24, alignItems: 'center' }}>
                <Ionicons name="storefront-outline" size={40} color="#c8e6d8" style={{ marginBottom: 12 }} />
                <Text style={{ fontSize: 14, fontWeight: '600', color: '#555', marginBottom: 6, textAlign: 'center' }}>Nenhum orçamento ainda</Text>
                <Text style={{ fontSize: 12, color: '#aaa', textAlign: 'center', marginBottom: 20, lineHeight: 17 }}>
                  As farmácias parceiras serão notificadas automaticamente quando o Zapi estiver configurado.
                </Text>
                <TouchableOpacity
                  style={{ backgroundColor: '#6366f1', borderRadius: 12, paddingHorizontal: 20, paddingVertical: 12, flexDirection: 'row', alignItems: 'center', gap: 8 }}
                  onPress={solicitarOrcamento}
                  disabled={loadingCotacoes}
                >
                  {loadingCotacoes
                    ? <ActivityIndicator size="small" color="white" />
                    : <><Ionicons name="send-outline" size={16} color="white" /><Text style={{ color: 'white', fontWeight: '700', fontSize: 14 }}>Solicitar orçamentos</Text></>
                  }
                </TouchableOpacity>
              </View>
            ) : (
              <>
                <Text style={{ fontSize: 12, fontWeight: '700', color: '#888', textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 10 }}>
                  {cotacoes.length} farmácia{cotacoes.length > 1 ? 's' : ''} respondeu
                </Text>
                {cotacoes.map((cot, idx) => (
                  <View key={cot.id || idx} style={{ backgroundColor: 'white', borderRadius: 14, padding: 16, marginBottom: 10, borderWidth: cot.status === 'melhor' ? 2 : 0.5, borderColor: cot.status === 'melhor' ? '#1D9E75' : '#eee' }}>
                    {cot.status === 'melhor' && (
                      <View style={{ backgroundColor: '#1D9E75', borderRadius: 6, paddingHorizontal: 8, paddingVertical: 3, alignSelf: 'flex-start', marginBottom: 8 }}>
                        <Text style={{ fontSize: 10, color: 'white', fontWeight: '700' }}>MELHOR PREÇO</Text>
                      </View>
                    )}
                    <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 8 }}>
                      <View style={{ flex: 1 }}>
                        <Text style={{ fontSize: 15, fontWeight: '700', color: '#0f1f1a' }}>{cot.farmacia_nome || 'Farmácia'}</Text>
                        {cot.prazo ? <Text style={{ fontSize: 12, color: '#999', marginTop: 2 }}>Prazo: {cot.prazo}</Text> : null}
                      </View>
                      {cot.preco ? (
                        <Text style={{ fontSize: 20, fontWeight: '800', color: '#1D9E75' }}>
                          R$ {(parseFloat(cot.preco||0) + parseFloat(cot.valor_frete||0) + 8).toFixed(2).replace('.', ',')}
                        </Text>
                      ) : (
                        <View style={{ backgroundColor: '#fff7e6', borderRadius: 8, paddingHorizontal: 10, paddingVertical: 4 }}>
                          <Text style={{ fontSize: 11, color: '#f59e0b', fontWeight: '600' }}>Aguardando</Text>
                        </View>
                      )}
                    </View>
                    {cot.observacao ? <Text style={{ fontSize: 12, color: '#888', marginBottom: 10, fontStyle: 'italic' }}>"{cot.observacao}"</Text> : null}
                    {cot.preco && (
                      <TouchableOpacity
                        style={{ backgroundColor: '#1D9E75', borderRadius: 10, padding: 12, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8 }}
                        onPress={() => {
                          setCotacaoSelecionada({ ...cot });
                          setShowCotacoes(false);
                          setTimeout(() => setShowPagamento(true), 500);
                        }}
                      >
                        <Ionicons name="card-outline" size={18} color="white" />
                        <Text style={{ color: 'white', fontWeight: '700', fontSize: 14 }}>Comprar agora</Text>
                      </TouchableOpacity>
                    )}
                    {!cot.preco && cot.farmacia_wa && (
                      <TouchableOpacity
                        style={{ backgroundColor: '#25D366', borderRadius: 10, padding: 12, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8 }}
                        onPress={() => {
                          const nomeProd = manip?.nome || 'a fórmula manipulada';
                          const msg = 'Olá ' + (cot.farmacia_nome || '') + '! Gostaria de fazer o pedido de ' + nomeProd + '. Vi o orçamento pelo Synka. Poderia confirmar os detalhes?';
                          const num = cot.farmacia_wa.replace(/\D/g, '');
                          const numBR = num.startsWith('55') ? num : '55' + num;
                          Linking.openURL('https://wa.me/' + numBR + '?text=' + encodeURIComponent(msg)).catch(() => {});
                        }}
                      >
                        <Ionicons name="logo-whatsapp" size={18} color="white" />
                        <Text style={{ color: 'white', fontWeight: '700', fontSize: 14 }}>Pedir por WhatsApp</Text>
                      </TouchableOpacity>
                    )}
                  </View>
                ))}
              </>
            )}
          </ScrollView>
        </SafeAreaView>
      </Modal>

      {/* Modal de Pagamento */}
      <Modal visible={showPagamento} animationType="slide" presentationStyle="pageSheet" onRequestClose={() => { setShowPagamento(false); setPixQrCode(null); }}>
        <SafeAreaView style={{ flex: 1, backgroundColor: '#f5f7f6' }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 20, paddingVertical: 16, backgroundColor: 'white', borderBottomWidth: 1, borderBottomColor: '#f0f0f0' }}>
            <View>
              <Text style={{ fontSize: 17, fontWeight: '700', color: '#0f1f1a' }}>Finalizar pedido</Text>
              <Text style={{ fontSize: 12, color: '#999', marginTop: 2 }}>{cotacaoSelecionada?.farmacia_nome}</Text>
            </View>
            <TouchableOpacity onPress={() => { setShowPagamento(false); setPixQrCode(null); }} style={{ padding: 4 }}>
              <Ionicons name="close" size={24} color="#666" />
            </TouchableOpacity>
          </View>

          <ScrollView contentContainerStyle={{ padding: 20 }}>
            {/* Breakdown de preço */}
            {cotacaoSelecionada && (() => {
              const preco = parseFloat(cotacaoSelecionada.preco || 0);
              const frete = parseFloat(cotacaoSelecionada.valor_frete || 0);
              const taxa = 8; // alinhado com criar-pagamento/index.ts
              const total = parseFloat((preco + frete + taxa).toFixed(2));
              return (
                <View style={{ backgroundColor: 'white', borderRadius: 16, padding: 16, marginBottom: 16 }}>
                  <Text style={{ fontSize: 14, fontWeight: '700', color: '#0f1f1a', marginBottom: 12 }}>Resumo do pedido</Text>
                  <View style={{ gap: 10 }}>
                    <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
                      <Text style={{ fontSize: 14, color: '#666' }}>Manipulado</Text>
                      <Text style={{ fontSize: 14, color: '#0f1f1a', fontWeight: '600' }}>R$ {preco.toFixed(2).replace('.', ',')}</Text>
                    </View>
                    <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
                      <Text style={{ fontSize: 14, color: '#666' }}>Frete</Text>
                      <Text style={{ fontSize: 14, color: '#0f1f1a', fontWeight: '600' }}>{frete > 0 ? 'R$ ' + frete.toFixed(2).replace('.', ',') : 'Grátis'}</Text>
                    </View>
                    <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
                      <Text style={{ fontSize: 14, color: '#666' }}>Taxa de processamento</Text>
                      <Text style={{ fontSize: 14, color: '#0f1f1a', fontWeight: '600' }}>R$ {taxa.toFixed(2).replace('.', ',')}</Text>
                    </View>
                    <View style={{ height: 1, backgroundColor: '#f0f0f0', marginVertical: 4 }} />
                    <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
                      <Text style={{ fontSize: 16, fontWeight: '700', color: '#0f1f1a' }}>Total</Text>
                      <Text style={{ fontSize: 20, fontWeight: '800', color: '#1D9E75' }}>R$ {total.toFixed(2).replace('.', ',')}</Text>
                    </View>
                  </View>
                  {cotacaoSelecionada.prazo && (
                    <View style={{ marginTop: 12, backgroundColor: '#f5f7f6', borderRadius: 10, padding: 10, flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                      <Ionicons name="time-outline" size={16} color="#888" />
                      <Text style={{ fontSize: 12, color: '#666' }}>Prazo de entrega: {cotacaoSelecionada.prazo}</Text>
                    </View>
                  )}
                </View>
              );
            })()}

            {/* Método de pagamento */}
            {!pixQrCode && (
              <View style={{ backgroundColor: 'white', borderRadius: 16, padding: 16, marginBottom: 16 }}>
                <Text style={{ fontSize: 14, fontWeight: '700', color: '#0f1f1a', marginBottom: 12 }}>Forma de pagamento</Text>
                <View style={{ gap: 10 }}>
                  {[
                    { key: 'pix', label: 'Pix', sub: 'Aprovação imediata', icon: '⚡' },
                    { key: 'credit_card', label: 'Cartão de crédito', sub: 'Até 12x', icon: '💳' },
                  ].map(m => (
                    <TouchableOpacity
                      key={m.key}
                      style={{ flexDirection: 'row', alignItems: 'center', padding: 14, borderRadius: 12, borderWidth: 1.5, borderColor: metodoPagamento === m.key ? '#1D9E75' : '#e0e0e0', backgroundColor: metodoPagamento === m.key ? '#f0f9f5' : 'white', gap: 12 }}
                      onPress={() => setMetodoPagamento(m.key)}
                    >
                      <Text style={{ fontSize: 22 }}>{m.icon}</Text>
                      <View style={{ flex: 1 }}>
                        <Text style={{ fontSize: 14, fontWeight: '600', color: '#0f1f1a' }}>{m.label}</Text>
                        <Text style={{ fontSize: 12, color: '#999' }}>{m.sub}</Text>
                      </View>
                      {metodoPagamento === m.key && <Ionicons name="checkmark-circle" size={22} color="#1D9E75" />}
                    </TouchableOpacity>
                  ))}
                </View>
              </View>
            )}

            {/* QR Code Pix */}
            {pixQrCode && (
              <View style={{ backgroundColor: 'white', borderRadius: 16, padding: 20, marginBottom: 16, alignItems: 'center' }}>
                <View style={{ width: 12, height: 12, borderRadius: 6, backgroundColor: '#1D9E75', marginBottom: 12 }} />
                <Text style={{ fontSize: 16, fontWeight: '700', color: '#0f1f1a', marginBottom: 4 }}>Pague com Pix</Text>
                <Text style={{ fontSize: 12, color: '#888', marginBottom: 16, textAlign: 'center' }}>Copie o código abaixo e cole no seu app de banco</Text>
                <TouchableOpacity
                  style={{ backgroundColor: '#f5f7f6', borderRadius: 12, padding: 14, width: '100%', marginBottom: 8 }}
                  onPress={() => {
                    Clipboard.setString(pixQrCode);
                    Alert.alert('✅ Copiado!', 'Cole no app do seu banco para pagar.');
                  }}
                >
                  <Text style={{ fontSize: 11, color: '#444', textAlign: 'center', fontFamily: 'monospace' }} numberOfLines={3}>{pixQrCode}</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={{ backgroundColor: '#1D9E75', borderRadius: 12, padding: 14, width: '100%', marginBottom: 12, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8 }}
                  onPress={() => {
                    Clipboard.setString(pixQrCode);
                    Alert.alert('✅ Copiado!', 'Cole no app do seu banco para pagar.');
                  }}
                >
                  <Ionicons name="copy-outline" size={18} color="white" />
                  <Text style={{ color: 'white', fontWeight: '700', fontSize: 15 }}>Copiar código Pix</Text>
                </TouchableOpacity>
                <View style={{ backgroundColor: '#e8f5f0', borderRadius: 12, padding: 12, width: '100%', flexDirection: 'row', gap: 8 }}>
                  <Ionicons name="information-circle-outline" size={16} color="#1D9E75" />
                  <Text style={{ fontSize: 12, color: '#1D9E75', flex: 1, lineHeight: 18 }}>Após o pagamento, você receberá a confirmação e a farmácia será notificada automaticamente.</Text>
                </View>
              </View>
            )}

            {/* Botão pagar */}
            {!pixQrCode && (
              <TouchableOpacity
                style={{ backgroundColor: '#1D9E75', borderRadius: 14, padding: 16, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, opacity: processandoPagamento ? 0.7 : 1 }}
                onPress={async () => {
                  if (!cotacaoSelecionada?.id) return;
                  setProcessandoPagamento(true);
                  try {
                    const { data: { session } } = await sb.auth.getSession();
                    const token = session?.access_token || SUPABASE_KEY;
                    const res = await fetch('https://iwrfgdfxvyqdkqdtrrxg.supabase.co/functions/v1/criar-pagamento', {
                      method: 'POST',
                      headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + token },
                      body: JSON.stringify({
                        cotacao_id: cotacaoSelecionada.id,
                        payment_method: metodoPagamento,
                        email_pagador: patient?.email || '',
                      }),
                    });
                    const data = await res.json();
                    if (data.error) {
                      Alert.alert('Erro no pagamento', data.error);
                    } else if (metodoPagamento === 'pix' && data.pix_qr_code) {
                      setPixQrCode(data.pix_qr_code);
                    } else {
                      Alert.alert('✅ Pagamento realizado!', 'A farmácia foi notificada e seu pedido está em preparo.');
                      setShowPagamento(false);
                      setPixQrCode(null);
                    }
                  } catch(e) {
                    Alert.alert('Erro', 'Não foi possível processar o pagamento.');
                  }
                  setProcessandoPagamento(false);
                }}
                disabled={processandoPagamento}
              >
                {processandoPagamento
                  ? <ActivityIndicator color="white" size="small" />
                  : <><Ionicons name="lock-closed-outline" size={18} color="white" /><Text style={{ color: 'white', fontWeight: '700', fontSize: 16 }}>Pagar com segurança</Text></>
                }
              </TouchableOpacity>
            )}

            <Text style={{ fontSize: 11, color: '#bbb', textAlign: 'center', marginTop: 12 }}>
              🔒 Pagamento processado pelo Mercado Pago. Seus dados estão protegidos.
            </Text>
          </ScrollView>
        </SafeAreaView>
      </Modal>

      {manip && (
        <TouchableOpacity
          style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, backgroundColor: '#f0f7f4', borderRadius: 10, padding: 10, marginTop: 8 }}
          onPress={() => gerarReceitaPDF(rec, patient?.name)}
        >
          <Ionicons name="document-text-outline" size={16} color="#1D9E75" />
          <Text style={{ fontSize: 13, fontWeight: '700', color: '#1D9E75' }}>Baixar receita (PDF)</Text>
        </TouchableOpacity>
      )}

      {manip && rec.status !== 'completed' && onUpdateStatus && (
        <View style={styles.produtoCardAcoesSecundarias}>
          {rec.status === 'not_started' && (
  <>
    <TouchableOpacity onPress={() => { onUpdateStatus(rec.id, 'active'); setShowCotacoes(false); }} style={styles.btnAcaoSecundaria}>
      <Ionicons name="bag-check-outline" size={14} color="#1D9E75" />
      <Text style={[styles.btnAcaoSecundariaText, { color: '#1D9E75' }]}>Já encomendei</Text>
    </TouchableOpacity>
    <View style={styles.btnAcaoSeparador} />
  </>
)}
          <TouchableOpacity onPress={handleConcluido} style={styles.btnAcaoSecundaria}>
            <Ionicons name="checkmark-circle-outline" size={14} color="#999" />
            <Text style={styles.btnAcaoSecundariaText}>Concluído</Text>
          </TouchableOpacity>
        </View>
      )}

      {/* Modal — Quantidade de comprimidos */}
      <Modal visible={showModalQuantidade} transparent animationType="fade" onRequestClose={() => setShowModalQuantidade(false)}>
        <View style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'center', alignItems: 'center', padding: 24 }}>
          <View style={{ backgroundColor: 'white', borderRadius: 20, padding: 24, width: '100%', maxWidth: 340 }}>
            <Text style={{ fontSize: 17, fontWeight: '700', color: '#0f1f1a', marginBottom: 6 }}>Quantos comprimidos vieram?</Text>
            <Text style={{ fontSize: 13, color: '#888', marginBottom: 16, lineHeight: 18 }}>
              Opcional — se preencher, vou calcular exatamente quando vai acabar e te avisar na hora certa.
            </Text>
            <TextInput
              style={{ backgroundColor: '#f5f5f5', borderRadius: 10, padding: 12, fontSize: 18, color: '#0f1f1a', textAlign: 'center', marginBottom: 16, borderWidth: 1, borderColor: '#e0e0e0' }}
              value={qtdComprimidos}
              onChangeText={setQtdComprimidos}
              placeholder="Ex: 30"
              placeholderTextColor="#bbb"
              keyboardType="number-pad"
              autoFocus
            />
            <TouchableOpacity
              style={{ backgroundColor: '#1D9E75', borderRadius: 12, padding: 14, alignItems: 'center', marginBottom: 10 }}
              onPress={confirmarCompra}
            >
              <Text style={{ color: 'white', fontWeight: '700', fontSize: 15 }}>Confirmar</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={{ backgroundColor: '#f5f5f5', borderRadius: 12, padding: 14, alignItems: 'center' }}
              onPress={confirmarCompra}
            >
              <Text style={{ color: '#666', fontWeight: '600', fontSize: 15 }}>Pular</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>

      {/* Modal — Avisar médico ao concluir */}
      <Modal visible={showModalConcluido} transparent animationType="fade" onRequestClose={() => setShowModalConcluido(false)}>
        <View style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'center', alignItems: 'center', padding: 24 }}>
          <View style={{ backgroundColor: 'white', borderRadius: 20, padding: 24, width: '100%', maxWidth: 340 }}>
            <View style={{ width: 52, height: 52, borderRadius: 26, backgroundColor: '#e8f5f0', alignItems: 'center', justifyContent: 'center', alignSelf: 'center', marginBottom: 14 }}>
              <Ionicons name="checkmark-circle" size={28} color="#1D9E75" />
            </View>
            <Text style={{ fontSize: 17, fontWeight: '700', color: '#0f1f1a', textAlign: 'center', marginBottom: 8 }}>Tratamento concluído!</Text>
            <Text style={{ fontSize: 13, color: '#666', textAlign: 'center', lineHeight: 18, marginBottom: 20 }}>
              Quer avisar o Dr(a). {rec.doctors?.name?.split(' ')[0]} que você terminou o tratamento de {rec.products?.name || 'o produto'}?
            </Text>
            <TouchableOpacity
              style={{ backgroundColor: '#25D366', borderRadius: 12, padding: 14, alignItems: 'center', flexDirection: 'row', justifyContent: 'center', gap: 8, marginBottom: 10 }}
              onPress={() => confirmarConcluido(true)}
            >
              <Ionicons name="logo-whatsapp" size={18} color="white" />
              <Text style={{ color: 'white', fontWeight: '700', fontSize: 15 }}>Sim, avisar pelo WhatsApp</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={{ backgroundColor: '#f5f5f5', borderRadius: 12, padding: 14, alignItems: 'center' }}
              onPress={() => confirmarConcluido(false)}
            >
              <Text style={{ color: '#666', fontWeight: '600', fontSize: 15 }}>Não, só concluir</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>

    </View>
  );
}

// ─── ABA INÍCIO ──────────────────────────────────────────────────────────────
function TabInicio({ recs, patient, onRefresh, onScan, onUpdateStatus, onBula }) {
  const [refreshing, setRefreshing] = useState(false);

  async function handleRefresh() {
    setRefreshing(true);
    await onRefresh();
    setRefreshing(false);
  }

  function calcFimTratamento(rec) {
    if (!rec.created_at || !rec.duration) return null;
    const dur = rec.duration || '';
    const match = dur.match(/([0-9]+)/);
    if (!match) return null;
    const num = parseInt(match[1]);
    const inicio = new Date(rec.created_at);
    if (/m[eê]s/i.test(dur)) inicio.setMonth(inicio.getMonth() + num);
    else if (/semana/i.test(dur)) inicio.setDate(inicio.getDate() + num * 7);
    else inicio.setDate(inicio.getDate() + num);
    return inicio;
  }

  const agora = new Date();
  const ha10dias = new Date(agora);
  ha10dias.setDate(ha10dias.getDate() - 10);

  const recentes = recs.filter(r => {
    if (r.status === 'completed' || r.status === 'active') return false;
    return new Date(r.created_at) >= ha10dias;
  });

  const acabando = recs.filter(r => {
    if (r.status !== 'active' && r.status !== 'not_started') return false;
    const fim = calcFimTratamento(r);
    if (!fim) return false;
    const dias = Math.round((fim - agora) / 86400000);
    return dias >= 0 && dias <= 7;
  });

  function abrirWhatsAppMedico(rec) {
    const nomeP = patient?.name?.split(' ')[0] || 'paciente';
    const produto = rec.products?.name || 'o tratamento';
    const msg = `Olá Dr(a). ${rec.doctors?.name?.split(' ')[0] || ''}! Sou ${nomeP} e meu tratamento de ${produto} está acabando. Gostaria de marcar um retorno.`;
    const tel = rec.doctors?.whatsapp;
    if (!tel) { Alert.alert('Sem contato', 'Não temos o WhatsApp do seu médico cadastrado.'); return; }
    const num = tel.replace(/\D/g, '');
    const numBR = num.startsWith('55') ? num : '55' + num;
    Linking.openURL(`https://wa.me/${numBR}?text=${encodeURIComponent(msg)}`);
  }

  return (
    <ScrollView style={styles.scroll} contentContainerStyle={styles.scrollContent} showsVerticalScrollIndicator={false} refreshControl={<RefreshControl refreshing={refreshing} onRefresh={handleRefresh} tintColor="#1D9E75" />}>
      <View style={styles.homeHeader}>
        <View>
          <Text style={styles.pageGreeting}>Olá, {patient?.name?.split(' ')[0] || 'paciente'}</Text>
          <Text style={styles.pageSubtitle}>synka.</Text>
        </View>
      </View>

      {recs.filter(r => {
        const m = parseManipulado(r.notes);
        return m && r.status !== 'completed' && r.status !== 'active';
      }).some(r => r._cotacoesNovas) && (
        <View style={{ backgroundColor: '#6366f1', borderRadius: 12, padding: 14, marginBottom: 12, flexDirection: 'row', alignItems: 'center', gap: 10 }}>
          <Ionicons name="storefront-outline" size={18} color="white" />
          <Text style={{ color: 'white', fontWeight: '700', fontSize: 14, flex: 1 }}>Farmácia respondeu! Veja os orçamentos</Text>
        </View>
      )}
      <TouchableOpacity style={styles.scanCardBtn} onPress={onScan} activeOpacity={0.85}>
        <View style={styles.scanCardBtnLeft}>
          <Ionicons name="scan-outline" size={22} color="#1D9E75" />
          <View>
            <Text style={styles.scanCardBtnTitle}>Escanear receita</Text>
            <Text style={styles.scanCardBtnSub}>Adicione uma receita médica</Text>
          </View>
        </View>
        <Ionicons name="chevron-forward" size={18} color="#ccc" />
      </TouchableOpacity>

      {acabando.map(r => {
        const fim = calcFimTratamento(r);
        const dias = fim ? Math.round((fim - agora) / 86400000) : null;
        const nomeP = patient?.name?.split(' ')[0] || 'paciente';
        const nomeProd = r.products?.name || 'o produto';
        const nomeMedico = r.doctors?.name?.split(' ')[0] || '';
        const temReceita = precisaReceita(nomeProd) || parseManipulado(r.notes);
        return (
          <View key={'acabando-' + r.id}>
            <View style={styles.bannerAcabando}>
              <Ionicons name="alert-circle-outline" size={20} color="#e05555" style={{ marginRight: 10, marginTop: 1 }} />
              <View style={styles.bannerInfo}>
                <Text style={styles.bannerTitulo}>{nomeProd} acaba {dias === 0 ? 'hoje' : `em ${dias} dia${dias > 1 ? 's' : ''}`}</Text>
                {r.return_date
                  ? <Text style={styles.bannerDesc}>Retorno: {new Date(r.return_date + 'T00:00:00').toLocaleDateString('pt-BR', { day: '2-digit', month: 'short' })}</Text>
                  : <TouchableOpacity onPress={() => abrirWhatsAppMedico(r)}><Text style={styles.bannerLink}>Marcar retorno com Dr(a). {nomeMedico} →</Text></TouchableOpacity>
                }
              </View>
            </View>
            {temReceita && r.doctors?.whatsapp && (
              <View style={{ backgroundColor: '#fff0f0', borderRadius: 12, padding: 14, marginBottom: 10, flexDirection: 'row', alignItems: 'flex-start', gap: 10, borderLeftWidth: 3, borderLeftColor: '#e05555' }}>
                <Ionicons name="document-text-outline" size={20} color="#e05555" style={{ marginTop: 1 }} />
                <View style={{ flex: 1 }}>
                  <Text style={{ fontSize: 13, fontWeight: '700', color: '#c0392b', marginBottom: 4 }}>Receita necessária</Text>
                  <Text style={{ fontSize: 12, color: '#c0392b', marginBottom: 8, lineHeight: 17 }}>
                    {nomeProd} precisa de receita médica. Solicite uma nova ao Dr(a). {nomeMedico} antes de acabar.
                  </Text>
                  <TouchableOpacity
                    style={{ backgroundColor: '#25D366', borderRadius: 10, padding: 10, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6 }}
                    onPress={() => {
                      const msg = 'Olá Dr(a). ' + nomeMedico + '! Meu tratamento de ' + nomeProd + ' está acabando e vou precisar de uma nova receita. Poderia me enviar? Obrigado(a)!';
                      const num = r.doctors.whatsapp.replace(/\D/g, '');
                      const numBR = num.startsWith('55') ? num : '55' + num;
                      Linking.openURL('https://wa.me/' + numBR + '?text=' + encodeURIComponent(msg)).catch(() => {});
                    }}
                  >
                    <Ionicons name="logo-whatsapp" size={16} color="white" />
                    <Text style={{ color: 'white', fontWeight: '700', fontSize: 13 }}>Solicitar receita pelo WhatsApp</Text>
                  </TouchableOpacity>
                </View>
              </View>
            )}
          </View>
        );
      })}

      {recentes.length > 0 && (
        <>
          <Text style={styles.homeSectionTitle}>Novas receitas</Text>
          {recentes.map(r => <ProdutoCard key={r.id + '-' + r.status} rec={r} showBuyBtn={true} onUpdateStatus={onUpdateStatus} onBula={onBula} patient={patient} />)}
        </>
      )}

      {recentes.length === 0 && acabando.length === 0 && (
        <View style={styles.emptyContainer}>
          <Ionicons name="checkmark-circle-outline" size={40} color="#c8e6d8" style={{ marginBottom: 10 }} />
          <Text style={styles.emptyTitle}>Tudo em dia!</Text>
          <Text style={styles.emptyDesc}>Nenhuma receita nova nos últimos 10 dias.</Text>
        </View>
      )}
    </ScrollView>
  );
}

// ─── ABA RECEITAS ─────────────────────────────────────────────────────────────
function TabReceitas({ recs, patient, onUpdateStatus, onLembrete, onBula, onAddProprio }) {
  const [filtro, setFiltro] = useState('todos');
  const [abertos, setAbertos] = useState({});
  const [inicializado, setInicializado] = useState(false);

  const porMedico = {};
  recs.forEach(r => {
    const medicoId = r.doctors?.id || r.doctor_id || 'sem-medico';
    const medicoNome = r.doctors?.name ? `Dr(a). ${r.doctors.name}` : 'Médico';
    if (!porMedico[medicoId]) porMedico[medicoId] = { id: medicoId, nome: medicoNome, recs: [] };
    porMedico[medicoId].recs.push(r);
  });

  const grupos = Object.values(porMedico);

  useEffect(() => {
    if (!inicializado && grupos.length > 0) {
      const init = {};
      grupos.forEach(g => { init[g.id] = false; });
      setAbertos(init);
      setInicializado(true);
    }
  }, [grupos.length]);

  function toggleGrupo(id) { setAbertos(prev => ({ ...prev, [id]: !prev[id] })); }

  const filtros = [
    { key: 'todos', label: 'Todos' },
    { key: 'not_started', label: 'Pendentes' },
    { key: 'active', label: 'Em uso' },
    { key: 'completed', label: 'Concluídos' },
  ];

  return (
    <View style={styles.flex}>
      <View style={styles.pageHeaderSimples}>
        <View>
          <Text style={styles.pageTitle}>Receitas</Text>
          <Text style={styles.pageSubtitleSmall}>Histórico das suas prescrições</Text>
        </View>
        <TouchableOpacity onPress={onAddProprio} style={{ backgroundColor: '#e8f5f0', borderRadius: 20, paddingHorizontal: 12, paddingVertical: 6, flexDirection: 'row', alignItems: 'center', gap: 4 }}>
          <Ionicons name="add" size={16} color="#1D9E75" />
          <Text style={{ fontSize: 13, color: '#1D9E75', fontWeight: '600' }}>Adicionar</Text>
        </TouchableOpacity>
      </View>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.filtrosScroll} contentContainerStyle={styles.filtrosContent}>
        {filtros.map(f => (
          <TouchableOpacity key={f.key} style={[styles.filtroBtn, filtro === f.key && styles.filtroBtnAtivo]} onPress={() => setFiltro(f.key)}>
            <Text style={[styles.filtroBtnText, filtro === f.key && styles.filtroBtnTextAtivo]}>{f.label}</Text>
          </TouchableOpacity>
        ))}
      </ScrollView>
      <ScrollView style={styles.scroll} contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: 24 }}>
        {grupos.map(grupo => {
          const recsFiltradas = filtro === 'todos' ? grupo.recs : grupo.recs.filter(r => r.status === filtro);
          if (recsFiltradas.length === 0) return null;
          const aberto = abertos[grupo.id] !== false;
          return (
            <View key={grupo.id} style={styles.medicoGrupo}>
              <TouchableOpacity style={styles.medicoGrupoHeader} onPress={() => toggleGrupo(grupo.id)} activeOpacity={0.7}>
                <View style={styles.medicoGrupoLeft}>
                  <View style={styles.medicoAvatar}>
                    <Text style={styles.medicoAvatarText}>{grupo.nome.replace('Dr(a). ', '').charAt(0).toUpperCase()}</Text>
                  </View>
                  <View>
                    <Text style={styles.medicoGrupoNome}>{grupo.nome}</Text>
                    <Text style={styles.medicoGrupoCount}>{recsFiltradas.length} receita{recsFiltradas.length !== 1 ? 's' : ''}</Text>
                  </View>
                </View>
                <Text style={styles.medicoGrupoSeta}>{aberto ? '▲' : '▼'}</Text>
              </TouchableOpacity>
              {aberto && recsFiltradas.map(r => <ProdutoCard key={r.id} rec={r} showBuyBtn={true} patient={patient} onUpdateStatus={onUpdateStatus} onLembrete={onLembrete} onBula={onBula} />)}
            </View>
          );
        })}
        {recs.length === 0 && (
          <View style={styles.emptyContainer}>
            <Text style={styles.emptyTitle}>Nenhuma receita ainda</Text>
            <Text style={styles.emptyDesc}>Suas prescrições médicas aparecerão aqui.</Text>
          </View>
        )}
        {recs.length > 0 && filtro !== 'todos' && !grupos.some(g => g.recs.some(r => r.status === filtro)) && (
          <View style={styles.emptyContainer}>
            <Text style={styles.emptyTitle}>
              {filtro === 'not_started' ? 'Nenhuma receita pendente' : filtro === 'active' ? 'Nenhum remédio em uso' : 'Nenhuma receita concluída'}
            </Text>
            <Text style={styles.emptyDesc}>
              {filtro === 'not_started' ? 'Você não tem prescrições aguardando início.' : filtro === 'active' ? 'Você não tem tratamentos em andamento.' : 'Você ainda não concluiu nenhum tratamento.'}
            </Text>
          </View>
        )}
      </ScrollView>
    </View>
  );
}

// ─── ABA LEMBRETES ────────────────────────────────────────────────────────────
function TabLembretes({ recs, produtoInicial, onClearProdutoInicial }) {
  const [lembretesSalvos, setLembretesSalvos] = useState([]);
  const [produtoSel, setProdutoSel] = useState('');
  const [tipoSel, setTipoSel] = useState(0);
  const [hora, setHora] = useState('09:00');
  const [showForm, setShowForm] = useState(false);
  const [showProdutoList, setShowProdutoList] = useState(false);
  const [salvando, setSalvando] = useState(false);

  const TIPOS = [
    { label: 'Lembrete diário', desc: 'Todo dia no horário escolhido' },
    { label: 'Tomar hoje', desc: 'Lembrete único para hoje' },
    { label: 'Lembrete de compra', desc: 'Me lembra de comprar esse produto' },
    { label: 'Lembrete de recompra', desc: 'Quando o tratamento estiver acabando' },
  ];

  const ativos = recs.filter(r => (r.status === 'not_started' || r.status === 'active') && !parseManipulado(r.notes));

  useEffect(() => {
    AsyncStorage.getItem('prescreve_reminders').then(data => {
      if (data) setLembretesSalvos(JSON.parse(data));
    });
  }, []);

  useEffect(() => {
    if (produtoInicial) {
      setProdutoSel(produtoInicial);
      setShowForm(true);
      onClearProdutoInicial?.();
    } else if (ativos.length > 0 && !produtoSel) {
      setProdutoSel(ativos[0].products?.name || '');
    }
  }, [produtoInicial, ativos.length]);

  async function salvarLembrete() {
    if (!produtoSel.trim()) { Alert.alert('Selecione um produto'); return; }

    setSalvando(true);

    // Pedir permissão
    const temPermissao = await pedirPermissaoNotificacoes();
    if (!temPermissao) {
      Alert.alert(
        'Permissão negada',
        'Para receber lembretes, ative as notificações do Synka em Configurações > Synka > Notificações.'
      );
      setSalvando(false);
      return;
    }

    let notifId = null;
    const tipoLabel = TIPOS[tipoSel].label;

    try {
      if (tipoLabel === 'Lembrete diário') {
        notifId = await agendarNotificacaoDiaria(produtoSel, hora, null);
      } else if (tipoLabel === 'Tomar hoje') {
        notifId = await agendarNotificacaoUnica(produtoSel, hora);
      } else if (tipoLabel === 'Lembrete de compra') {
        notifId = await agendarNotificacaoUnica(produtoSel, hora);
      } else if (tipoLabel === 'Lembrete de recompra') {
        // Agendar para daqui 3 dias como padrão
        notifId = await agendarLembreteRecompra(produtoSel, 3);
      }
    } catch(e) {
      console.log('Erro ao agendar:', e);
    }

    const novo = { produto: produtoSel, tipo: tipoLabel, hora, notifId };
    const lista = [...lembretesSalvos, novo];
    setLembretesSalvos(lista);
    await AsyncStorage.setItem('prescreve_reminders', JSON.stringify(lista));
    setShowForm(false);
    setSalvando(false);

    Alert.alert(
      '✅ Lembrete ativado!',
      tipoLabel === 'Lembrete diário'
        ? `Você vai receber uma notificação todo dia às ${hora} sobre ${produtoSel}.`
        : `Você vai receber um lembrete sobre ${produtoSel}.`
    );
  }

  async function removerLembrete(idx) {
    const lembrete = lembretesSalvos[idx];
    // Cancelar notificação agendada
    if (lembrete?.notifId) {
      await cancelarNotificacao(lembrete.notifId);
    }
    const lista = lembretesSalvos.filter((_, i) => i !== idx);
    setLembretesSalvos(lista);
    await AsyncStorage.setItem('prescreve_reminders', JSON.stringify(lista));
  }

  return (
    <View style={styles.flex}>
      <View style={styles.pageHeaderSimples}>
        <View>
          <Text style={styles.pageTitle}>Lembretes</Text>
          <Text style={styles.pageSubtitleSmall}>Notificações de tratamento</Text>
        </View>
      </View>
      <ScrollView contentContainerStyle={{ padding: 16 }} keyboardShouldPersistTaps="handled">

        {/* Info sobre notificações */}
        <View style={{ backgroundColor: '#e8f5f0', borderRadius: 12, padding: 14, marginBottom: 16, flexDirection: 'row', gap: 10 }}>
          <Ionicons name="notifications-outline" size={18} color="#1D9E75" />
          <Text style={{ fontSize: 13, color: '#1D9E75', flex: 1, lineHeight: 18 }}>Os lembretes chegam como notificações reais no seu iPhone, mesmo com o app fechado.</Text>
        </View>

        {/* Lembretes salvos */}
        {lembretesSalvos.length === 0 ? (
          <Text style={{ fontSize: 13, color: '#aaa', textAlign: 'center', paddingVertical: 16 }}>Nenhum lembrete ativo ainda</Text>
        ) : lembretesSalvos.map((rem, idx) => (
          <View key={idx} style={styles.lembreteCard}>
            <View style={styles.lembreteRow}>
              <View style={{ width: 36, height: 36, borderRadius: 18, backgroundColor: '#e8f5f0', alignItems: 'center', justifyContent: 'center', marginRight: 4 }}>
                <Ionicons name="notifications" size={18} color="#1D9E75" />
              </View>
              <View style={styles.lembreteInfo}>
                <Text style={styles.lembreteNome}>{rem.produto}</Text>
                <Text style={styles.lembreteInstrucao}>
                  {rem.tipo} {rem.tipo === 'Lembrete diário' || rem.tipo === 'Tomar hoje' ? `· ${rem.hora}` : ''}
                  {rem.notifId ? ' · ativo ✓' : ''}
                </Text>
              </View>
              <TouchableOpacity onPress={() => removerLembrete(idx)} style={{ padding: 8 }}>
                <Ionicons name="trash-outline" size={18} color="#e05555" />
              </TouchableOpacity>
            </View>
          </View>
        ))}

        {/* Botão novo lembrete */}
        <TouchableOpacity style={styles.novoLembreteBtn} onPress={() => setShowForm(!showForm)}>
          <Text style={styles.novoLembreteBtnText}>{showForm ? '− Cancelar' : '+ Novo lembrete'}</Text>
        </TouchableOpacity>

        {/* Formulário */}
        {showForm && (
          <View style={styles.lembreteForm}>
            <View style={{ marginBottom: 12 }}>
              <Text style={styles.lembreteFormLabel}>Produto</Text>
              <TextInput
                style={[styles.input, { marginBottom: 6 }]}
                placeholder="Buscar ou digitar produto..."
                placeholderTextColor="#999"
                value={produtoSel}
                onChangeText={v => { setProdutoSel(v); setShowProdutoList(true); }}
                onFocus={() => setShowProdutoList(true)}
              />
              {showProdutoList && (
                <ScrollView style={styles.produtoPickerList} nestedScrollEnabled={true}>
                  {ativos.filter(r => {
                    const nome = r.products?.name || '';
                    return !produtoSel || nome.toLowerCase().includes(produtoSel.toLowerCase());
                  }).map(r => {
                    const nome = r.products?.name || '—';
                    return (
                      <TouchableOpacity key={r.id} style={[styles.produtoPickerItem, produtoSel === nome && styles.produtoPickerItemAtivo]} onPress={() => { setProdutoSel(nome); setShowProdutoList(false); }}>
                        <Text style={[styles.produtoPickerItemText, produtoSel === nome && { color: '#1D9E75', fontWeight: '700' }]}>{nome}</Text>
                        {produtoSel === nome && <Ionicons name="checkmark" size={14} color="#1D9E75" />}
                      </TouchableOpacity>
                    );
                  })}
                  {produtoSel && !ativos.find(r => r.products?.name?.toLowerCase() === produtoSel.toLowerCase()) && (
                    <TouchableOpacity style={styles.produtoPickerItem} onPress={() => setShowProdutoList(false)}>
                      <Text style={{ fontSize: 13, color: '#1D9E75' }}>Usar "{produtoSel}"</Text>
                    </TouchableOpacity>
                  )}
                </ScrollView>
              )}
            </View>

            <Text style={styles.lembreteFormLabel}>Tipo</Text>
            {TIPOS.map((t, i) => (
              <TouchableOpacity key={i} style={[styles.tipoOpcao, tipoSel === i && styles.tipoOpcaoAtiva]} onPress={() => setTipoSel(i)}>
                <View style={styles.tipoOpcaoInfo}>
                  <Text style={[styles.tipoOpcaoLabel, tipoSel === i && { color: '#1D9E75' }]}>{t.label}</Text>
                  <Text style={styles.tipoOpcaoDesc}>{t.desc}</Text>
                </View>
                {tipoSel === i && <Text style={{ color: '#1D9E75', fontWeight: '700' }}>✓</Text>}
              </TouchableOpacity>
            ))}

            {(tipoSel === 0 || tipoSel === 1 || tipoSel === 2) && (
              <>
                <Text style={[styles.lembreteFormLabel, { marginTop: 12 }]}>Horário</Text>
                <View style={styles.horaRow}>
                  {['06:00','07:00','08:00','09:00','12:00','18:00','20:00','21:00'].map(h => (
                    <TouchableOpacity key={h} style={[styles.horaBadge, hora === h && styles.horaBadgeAtivo]} onPress={() => setHora(h)}>
                      <Text style={[styles.horaBadgeText, hora === h && styles.horaBadgeTextAtivo]}>{h}</Text>
                    </TouchableOpacity>
                  ))}
                </View>
                <Text style={styles.lembreteFormLabel}>Ou personalize:</Text>
                <TextInput style={[styles.input, { backgroundColor: 'white', color: '#0f1f1a', borderWidth: 1, borderColor: '#e0e0e0' }]} value={hora} onChangeText={setHora} placeholder="Ex: 14:30" placeholderTextColor="#999" keyboardType="numbers-and-punctuation" />
              </>
            )}

            <TouchableOpacity
              style={[styles.btnComprar, { marginTop: 14, opacity: salvando ? 0.7 : 1 }]}
              onPress={salvarLembrete}
              disabled={salvando}
            >
              {salvando
                ? <ActivityIndicator color="white" size="small" />
                : <Text style={styles.btnComprarText}>Ativar lembrete</Text>
              }
            </TouchableOpacity>
          </View>
        )}
      </ScrollView>
    </View>
  );
}

// ─── ABA PERFIL ───────────────────────────────────────────────────────────────
function ArmarioCategoriaCard({ categoria, itens, onRemover }) {
  const [aberto, setAberto] = useState(true);
  const ICONES = {
    'Estômago': 'nutrition-outline',
    'Dor & Febre': 'thermometer-outline',
    'Alergia': 'leaf-outline',
    'Antibióticos': 'shield-checkmark-outline',
    'Vitaminas': 'sunny-outline',
    'Pressão & Coração': 'heart-outline',
    'Diabetes': 'water-outline',
    'Tireoide': 'pulse-outline',
    'Hormônios': 'flask-outline',
    'Ansiedade & Sono': 'moon-outline',
    'Respiratório': 'cloud-outline',
    'Pele & Cabelo': 'sparkles-outline',
    'Outros': 'medical-outline',
  };
  const icone = ICONES[categoria] || 'medical-outline';
  const hoje = new Date();

  return (
    <View style={{ marginBottom: 10 }}>
      <TouchableOpacity
        style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', backgroundColor: 'white', borderRadius: 14, padding: 14, shadowColor: '#000', shadowOpacity: 0.03, shadowRadius: 4, elevation: 1 }}
        onPress={() => setAberto(!aberto)}
        activeOpacity={0.7}
      >
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
          <View style={{ width: 36, height: 36, borderRadius: 18, backgroundColor: '#e8f5f0', alignItems: 'center', justifyContent: 'center' }}>
            <Ionicons name={icone} size={18} color="#1D9E75" />
          </View>
          <View>
            <Text style={{ fontSize: 14, fontWeight: '700', color: '#0f1f1a' }}>{categoria}</Text>
            <Text style={{ fontSize: 11, color: '#999', marginTop: 1 }}>{itens.length} medicamento{itens.length > 1 ? 's' : ''}</Text>
          </View>
        </View>
        <Ionicons name={aberto ? 'chevron-up' : 'chevron-down'} size={18} color="#bbb" />
      </TouchableOpacity>

      {aberto && (
        <View style={{ backgroundColor: '#f9fdfc', borderRadius: 12, marginTop: 4, overflow: 'hidden', borderWidth: 0.5, borderColor: '#e8f0ec' }}>
          {itens.map((grupo, idx) => {
            const validade = grupo.data_validade ? new Date(grupo.data_validade + 'T00:00:00') : null;
            const diasValidade = validade ? Math.round((validade - hoje) / 86400000) : null;
            const vencido = diasValidade !== null && diasValidade < 0;
            const vencendoEmBreve = diasValidade !== null && diasValidade >= 0 && diasValidade <= 30;
            return (
              <View key={grupo.id} style={{ flexDirection: 'row', alignItems: 'center', paddingHorizontal: 14, paddingVertical: 12, borderBottomWidth: idx < itens.length - 1 ? 0.5 : 0, borderBottomColor: '#e8f0ec', backgroundColor: vencido ? '#fff5f5' : 'transparent' }}>
                <View style={{ flex: 1 }}>
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                    <Text style={{ fontSize: 14, fontWeight: '600', color: '#0f1f1a' }}>{grupo.nome}</Text>
                    {grupo.count > 1 && (
                      <View style={{ backgroundColor: '#e8f5f0', borderRadius: 8, paddingHorizontal: 7, paddingVertical: 2 }}>
                        <Text style={{ fontSize: 11, color: '#1D9E75', fontWeight: '700' }}>x{grupo.count}</Text>
                      </View>
                    )}
                    {vencido && (
                      <View style={{ backgroundColor: '#fff0f0', borderRadius: 6, paddingHorizontal: 6, paddingVertical: 2 }}>
                        <Text style={{ fontSize: 9, color: '#e05555', fontWeight: '700' }}>VENCIDO</Text>
                      </View>
                    )}
                    {vencendoEmBreve && (
                      <View style={{ backgroundColor: '#fff7e6', borderRadius: 6, paddingHorizontal: 6, paddingVertical: 2 }}>
                        <Text style={{ fontSize: 9, color: '#f59e0b', fontWeight: '700' }}>VENCE EM {diasValidade}d</Text>
                      </View>
                    )}
                  </View>
                  {grupo.dosagem ? <Text style={{ fontSize: 11, color: '#888', marginTop: 2 }}>{grupo.dosagem}</Text> : null}
                  {grupo.data_validade ? (
                    <Text style={{ fontSize: 10, color: vencido ? '#e05555' : vencendoEmBreve ? '#f59e0b' : '#bbb', marginTop: 2 }}>
                      Val: {new Date(grupo.data_validade + 'T00:00:00').toLocaleDateString('pt-BR', { day: '2-digit', month: 'short', year: 'numeric' })}
                    </Text>
                  ) : null}
                </View>
                <TouchableOpacity
                  onPress={() => onRemover(grupo.ids[grupo.ids.length - 1])}
                  style={{ width: 32, height: 32, backgroundColor: '#fff0f0', borderRadius: 10, alignItems: 'center', justifyContent: 'center', marginLeft: 8 }}
                >
                  <Ionicons name="remove" size={16} color="#e05555" />
                  {grupo.count > 1 && <Text style={{ fontSize: 8, color: '#e05555', fontWeight: '700' }}>-1</Text>}
                </TouchableOpacity>
              </View>
            );
          })}
        </View>
      )}
    </View>
  );
}

function ExameCard({ exame, filtroExame, onRemover }) {
  const [aberto, setAberto] = useState(false);

  const itensFiltrados = filtroExame
    ? (exame.itens || []).filter(it => it.nome?.toLowerCase().includes(filtroExame.toLowerCase()))
    : (exame.itens || []);
  const exameMatch = !filtroExame || exame.nome?.toLowerCase().includes(filtroExame.toLowerCase()) || itensFiltrados.length > 0;
  if (!exameMatch) return null;
  const itensParaMostrar = filtroExame && !exame.nome?.toLowerCase().includes(filtroExame.toLowerCase()) ? itensFiltrados : (exame.itens || []);
  const totalAlterados = (exame.itens || []).filter(it => {
    const v = parseFloat(it.resultado);
    const min = parseFloat(it.refMin);
    const max = parseFloat(it.refMax);
    return !isNaN(v) && ((it.refMin && v < min) || (it.refMax && v > max));
  }).length;

  return (
    <View style={{ backgroundColor: 'white', borderRadius: 14, marginBottom: 10, shadowColor: '#000', shadowOpacity: 0.04, shadowRadius: 6, elevation: 1, overflow: 'hidden' }}>
      <TouchableOpacity
        style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', padding: 14 }}
        onPress={() => setAberto(!aberto)}
        activeOpacity={0.7}
      >
        <View style={{ flex: 1 }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
            <Text style={{ fontSize: 15, fontWeight: '700', color: '#0f1f1a' }}>{exame.nome}</Text>
            {exame._scanned && (
              <View style={{ backgroundColor: '#e8f5f0', borderRadius: 8, paddingHorizontal: 7, paddingVertical: 2 }}>
                <Text style={{ fontSize: 9, color: '#1D9E75', fontWeight: '700' }}>IA</Text>
              </View>
            )}
            {totalAlterados > 0 && (
              <View style={{ backgroundColor: '#fff0f0', borderRadius: 8, paddingHorizontal: 7, paddingVertical: 2 }}>
                <Text style={{ fontSize: 9, color: '#e05555', fontWeight: '700' }}>{totalAlterados} ↑↓</Text>
              </View>
            )}
          </View>
          <Text style={{ fontSize: 11, color: '#999', marginTop: 3 }}>
            {new Date(exame.data).toLocaleDateString('pt-BR', { day: '2-digit', month: 'short', year: 'numeric' })}
            {exame.laboratorio ? ' · ' + exame.laboratorio : ''}
            {' · '}{(exame.itens || []).length} itens
          </Text>
        </View>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
          <TouchableOpacity onPress={() => onRemover(exame.id)} style={{ padding: 4 }}>
            <Ionicons name="trash-outline" size={16} color="#e05555" />
          </TouchableOpacity>
          <Ionicons name={aberto ? 'chevron-up' : 'chevron-down'} size={18} color="#bbb" />
        </View>
      </TouchableOpacity>

      {aberto && itensParaMostrar.length > 0 && (
        <View style={{ borderTopWidth: 0.5, borderTopColor: '#f0f0f0' }}>
          {itensParaMostrar.map((item, idx) => {
            const v = parseFloat(item.resultado);
            const min = parseFloat(item.refMin);
            const max = parseFloat(item.refMax);
            const baixo = !isNaN(v) && item.refMin && v < min;
            const alto = !isNaN(v) && item.refMax && v > max;
            const normal = !baixo && !alto && item.resultado;
            const corValor = baixo ? '#3b82f6' : alto ? '#e05555' : '#1D9E75';
            const bgRow = baixo ? '#f0f7ff' : alto ? '#fff5f5' : idx % 2 === 0 ? 'white' : '#fafafa';
            return (
              <View key={idx} style={{ flexDirection: 'row', alignItems: 'center', paddingHorizontal: 14, paddingVertical: 11, backgroundColor: bgRow, borderBottomWidth: idx < itensParaMostrar.length - 1 ? 0.5 : 0, borderBottomColor: '#ececec' }}>
                <View style={{ flex: 1, paddingRight: 8 }}>
                  <Text style={{ fontSize: 13, fontWeight: '500', color: '#0f1f1a' }}>{item.nome}</Text>
                  {(item.refMin || item.refMax) && (
                    <Text style={{ fontSize: 10, color: '#bbb', marginTop: 2 }}>
                      Ref: {item.refMin || '—'} – {item.refMax || '—'}{item.unidade ? ' ' + item.unidade : ''}
                    </Text>
                  )}
                </View>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                  <View style={{ alignItems: 'flex-end' }}>
                    <Text style={{ fontSize: 14, fontWeight: '700', color: corValor }}>{item.resultado || '—'}</Text>
                    {item.unidade ? <Text style={{ fontSize: 10, color: '#bbb' }}>{item.unidade}</Text> : null}
                  </View>
                  {(baixo || alto) && (
                    <View style={{ backgroundColor: corValor, borderRadius: 5, paddingHorizontal: 5, paddingVertical: 2 }}>
                      <Text style={{ fontSize: 8, color: 'white', fontWeight: '700' }}>{baixo ? '↓' : '↑'}</Text>
                    </View>
                  )}
                  {normal && (
                    <View style={{ backgroundColor: '#e8f5f0', borderRadius: 5, paddingHorizontal: 5, paddingVertical: 2 }}>
                      <Text style={{ fontSize: 8, color: '#1D9E75', fontWeight: '700' }}>✓</Text>
                    </View>
                  )}
                </View>
              </View>
            );
          })}
        </View>
      )}
      {aberto && itensParaMostrar.length === 0 && !filtroExame && (
        <Text style={{ fontSize: 12, color: '#bbb', textAlign: 'center', padding: 16 }}>Sem itens cadastrados</Text>
      )}
    </View>
  );
}

function TabPerfil({ patient, recs, onLogout }) {
  const [secao, setSecao] = useState(null);
  const [exames, setExames] = useState([]);
  const [showAddExame, setShowAddExame] = useState(false);
  const [novoExameNome, setNovoExameNome] = useState('');
  const [novoExameLab, setNovoExameLab] = useState('');
  const [novoExameItens, setNovoExameItens] = useState([{ nome: '', resultado: '', unidade: '', refMin: '', refMax: '' }]);
  const [scanningPDF, setScanningPDF] = useState(false);
  const [filtroExame, setFiltroExame] = useState('');
  const [armario, setArmario] = useState([]);
  const [showAddArmario, setShowAddArmario] = useState(false);
  const [armNome, setArmNome] = useState('');
  const [armDosagem, setArmDosagem] = useState('');
  const [armQtd, setArmQtd] = useState('');
  const [armUnidade, setArmUnidade] = useState('comprimidos');
  const [armValidade, setArmValidade] = useState('');
  const [armSalvando, setArmSalvando] = useState(false);
  const [armIdentificando, setArmIdentificando] = useState(false);
  const [filtroArmario, setFiltroArmario] = useState('Todos');
  const [mesCal, setMesCal] = useState(() => new Date().toISOString().slice(0, 7));
  const [diaCal, setDiaCal] = useState(null);
  const [subSecaoDia, setSubSecaoDia] = useState('prescritos');
  const [editando, setEditando] = useState(false);
  const [editNome, setEditNome] = useState(patient?.name || '');
  const [editTel, setEditTel] = useState(patient?.whatsapp || '');
  const [editCep, setEditCep] = useState('');
  const [editRua, setEditRua] = useState('');
  const [editNumero, setEditNumero] = useState('');
  const [editCompl, setEditCompl] = useState('');
  const [editBairro, setEditBairro] = useState('');
  const [editCidade, setEditCidade] = useState('');
  const [editEstado, setEditEstado] = useState('');
  const [salvando, setSalvando] = useState(false);
  const [cepLoading, setCepLoading] = useState(false);

  useEffect(() => {
    if (patient) { setEditNome(patient.name || ''); setEditTel(patient.whatsapp || ''); if (patient.address) setEditRua(patient.address); }
  }, [patient?.id]);

  async function buscarCepEdit(cep) {
    const digits = cep.replace(/[^0-9]/g, '');
    if (digits.length !== 8) return;
    setCepLoading(true);
    try {
      const res = await fetch('https://viacep.com.br/ws/' + digits + '/json/');
      const data = await res.json();
      if (!data.erro) { setEditRua(data.logradouro || ''); setEditBairro(data.bairro || ''); setEditCidade(data.localidade || ''); setEditEstado(data.uf || ''); }
    } catch(e) {}
    setCepLoading(false);
  }

  async function salvarDados() {
    setSalvando(true);
    const endParts = [editRua, editNumero, editCompl, editBairro, editCidade + (editEstado ? ' - ' + editEstado : ''), editCep ? 'CEP ' + editCep : ''].filter(Boolean);
    const address = endParts.length > 1 ? endParts.join(', ') : (editRua || null);
    const { error } = await sb.from('patients').update({ name: editNome, whatsapp: editTel.replace(/[^0-9]/g, '') || null, address }).eq('id', patient.id);
    setSalvando(false);
    if (error) { Alert.alert('Erro ao salvar', error.message); return; }
    patient.name = editNome; patient.whatsapp = editTel.replace(/[^0-9]/g, '') || null; patient.address = address;
    setEditando(false);
    Alert.alert('Dados atualizados!');
  }

  // Carregar exames do Supabase
  useEffect(() => {
    if (!patient?.id) return;
    async function loadExames() {
      const { data } = await sb.from('exames')
        .select('*')
        .eq('patient_id', patient.id)
        .order('created_at', { ascending: false });
      if (data) setExames(data);
    }
    loadExames();
  }, [patient?.id]);

  async function salvarExame() {
    if (!novoExameNome.trim()) { Alert.alert('Digite o nome do exame'); return; }
    const itensFiltrados = novoExameItens.filter(i => i.nome.trim());
    const novoExame = {
      nome: novoExameNome.trim(),
      laboratorio: novoExameLab.trim(),
      data: new Date().toISOString(),
      itens: itensFiltrados,
      _scanned: false,
      patient_id: patient?.id,
    };
    // Salva no Supabase
    const { data: saved, error } = await sb.from('exames').insert(novoExame).select().single();
    const exameComId = saved || { ...novoExame, id: Date.now().toString() };
    const novosExames = [exameComId, ...exames];
    setExames(novosExames);
    setShowAddExame(false);
    setNovoExameNome('');
    setNovoExameLab('');
    setNovoExameItens([{ nome: '', resultado: '', unidade: '', refMin: '', refMax: '' }]);
    Alert.alert('✓ Exame salvo!');
  }

  function addItemExame() {
    setNovoExameItens(prev => [...prev, { nome: '', resultado: '', unidade: '', refMin: '', refMax: '' }]);
  }

  function updateItemExame(idx, campo, valor) {
    setNovoExameItens(prev => prev.map((it, i) => i === idx ? { ...it, [campo]: valor } : it));
  }

  function removeItemExame(idx) {
    setNovoExameItens(prev => prev.filter((_, i) => i !== idx));
  }

  async function removerExame(id) {
    Alert.alert('Remover exame?', '', [
      { text: 'Cancelar', style: 'cancel' },
      { text: 'Remover', style: 'destructive', onPress: async () => {
        await sb.from('exames').delete().eq('id', id);
        setExames(prev => prev.filter(e => e.id !== id));
      }},
    ]);
  }

  // Carregar armário do Supabase e recategorizar via IA se necessário
  useEffect(() => {
    if (!patient?.id) return;
    async function loadArmario() {
      const { data } = await sb.from('armario')
        .select('*')
        .eq('patient_id', patient.id)
        .order('created_at', { ascending: false });
      if (!data) return;
      // Recategoriza itens sem categoria via IA
      const recategorizados = await Promise.all(data.map(async item => {
        if (!item.categoria || item.categoria === 'Outros') {
          const cat = await categorizar(item.nome);
          if (cat && cat !== 'Outros') {
            await sb.from('armario').update({ categoria: cat }).eq('id', item.id);
            return { ...item, categoria: cat };
          }
        }
        return item;
      }));
      setArmario(recategorizados);
    }
    loadArmario();
  }, [patient?.id]);

  async function identificarRemedioPorFoto() {
    const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
    const { status: camStatus } = await ImagePicker.requestCameraPermissionsAsync();
    if (camStatus !== 'granted' && status !== 'granted') {
      Alert.alert('Permissão necessária'); return;
    }
    Alert.alert('Identificar remédio', 'Como quer enviar?', [
      { text: 'Câmera', onPress: () => capturarFotoRemedio('camera') },
      { text: 'Galeria', onPress: () => capturarFotoRemedio('library') },
      { text: 'Cancelar', style: 'cancel' },
    ]);
  }

  async function capturarFotoRemedio(source) {
    setArmIdentificando(true);
    try {
      const opts = { mediaTypes: ['images'], allowsEditing: true, quality: 0.7, base64: true };
      const result = source === 'camera'
        ? await ImagePicker.launchCameraAsync(opts)
        : await ImagePicker.launchImageLibraryAsync(opts);
      if (result.canceled) { setArmIdentificando(false); return; }
      const base64 = result.assets[0].base64;
      const { data: { session } } = await sb.auth.getSession();
      const token = session?.access_token || SUPABASE_KEY;
      const res = await fetch('https://iwrfgdfxvyqdkqdtrrxg.supabase.co/functions/v1/identify-medicine', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + token },
        body: JSON.stringify({ image: base64 }),
      });
      const data = await res.json();
      if (data.nome) {
        setArmNome(data.nome || '');
        setArmDosagem(data.dosagem || '');
        setShowAddArmario(true);
      } else {
        Alert.alert('Não identificado', 'Não consegui identificar o remédio. Digite manualmente.');
        setShowAddArmario(true);
      }
    } catch(e) {
      Alert.alert('Erro', 'Não foi possível identificar. Digite manualmente.');
      setShowAddArmario(true);
    }
    setArmIdentificando(false);
  }

  async function categorizar(nome) {
    try {
      const { data: { session } } = await sb.auth.getSession();
      const token = session?.access_token || SUPABASE_KEY;
      const res = await fetch('https://iwrfgdfxvyqdkqdtrrxg.supabase.co/functions/v1/categorize-medicine', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + token },
        body: JSON.stringify({ nome }),
      });
      const data = await res.json();
      return data.categoria || 'Outros';
    } catch(e) {
      return 'Outros';
    }
  }

  async function salvarArmario() {
    if (!armNome.trim()) { Alert.alert('Digite o nome do remédio'); return; }
    setArmSalvando(true);
    const categoria = await categorizar(armNome.trim());
    const novo = {
      patient_id: patient?.id,
      nome: armNome.trim(),
      dosagem: armDosagem.trim(),
      quantidade: armQtd ? parseInt(armQtd) : null,
      unidade_quantidade: armUnidade,
      data_validade: armValidade || null,
      categoria,
    };
    const { data: saved } = await sb.from('armario').insert(novo).select().single();
    const itemComId = saved || { ...novo, id: Date.now().toString() };
    setArmario(prev => [itemComId, ...prev]);
    setShowAddArmario(false);
    setArmNome(''); setArmDosagem(''); setArmQtd(''); setArmValidade('');
    setArmSalvando(false);
    Alert.alert('✓ Remédio adicionado!');
  }

  async function removerArmario(id) {
    Alert.alert('Remover remédio?', '', [
      { text: 'Cancelar', style: 'cancel' },
      { text: 'Remover', style: 'destructive', onPress: async () => {
        await sb.from('armario').delete().eq('id', id);
        setArmario(prev => prev.filter(a => a.id !== id));
      }},
    ]);
  }

  async function scanPDF() {
    try {
      // Seleciona o PDF
      const result = await DocumentPicker.getDocumentAsync({
        type: 'application/pdf',
        copyToCacheDirectory: true,
      });

      if (result.canceled || !result.assets || result.assets.length === 0) return;

      setScanningPDF(true);

      const asset = result.assets[0];
      const uri = asset.uri;

      // Lê o arquivo como base64 usando FileSystem
      let base64 = '';
      try {
        base64 = await FileSystem.readAsStringAsync(uri, {
          encoding: FileSystem.EncodingType.Base64,
        });
      } catch (readError) {
        // Fallback: tenta copiar para cache primeiro
        const cacheUri = FileSystem.cacheDirectory + 'exam_temp.pdf';
        await FileSystem.copyAsync({ from: uri, to: cacheUri });
        base64 = await FileSystem.readAsStringAsync(cacheUri, {
          encoding: FileSystem.EncodingType.Base64,
        });
      }

      if (!base64) {
        Alert.alert('Erro', 'Não foi possível ler o arquivo PDF.');
        setScanningPDF(false);
        return;
      }

      // Envia para Edge Function
      const { data: { session } } = await sb.auth.getSession();
      const token = session?.access_token || SUPABASE_KEY;

      const res = await fetch('https://iwrfgdfxvyqdkqdtrrxg.supabase.co/functions/v1/analyze-exam', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + token },
        body: JSON.stringify({ pdf: base64, filename: asset.name || 'exame.pdf' }),
      });

      if (!res.ok) {
        const errText = await res.text();
        console.log('Edge Function error:', errText);
        Alert.alert('Erro no servidor', 'Tente adicionar manualmente.');
        setScanningPDF(false);
        return;
      }

      const data = await res.json();

      if (!data.itens || data.itens.length === 0) {
        Alert.alert('Não encontrei resultados', 'O PDF não contém valores reconhecíveis. Tente adicionar manualmente.');
        setScanningPDF(false);
        return;
      }

      const novoExame = {
        nome: data.nome || asset.name?.replace('.pdf', '') || 'Exame',
        laboratorio: data.laboratorio || '',
        data: data.data || new Date().toISOString(),
        itens: data.itens,
        _scanned: true,
        patient_id: patient?.id,
      };

      // Salva no Supabase
      const { data: saved } = await sb.from('exames').insert(novoExame).select().single();
      const exameComId = saved || { ...novoExame, id: Date.now().toString() };
      const novosExames = [exameComId, ...exames];
      setExames(novosExames);
      setScanningPDF(false);
      Alert.alert('✓ ' + data.itens.length + ' itens encontrados!', 'Exame de ' + (novoExame.laboratorio || 'laboratório') + ' adicionado com sucesso.');
    } catch(e) {
      console.log('scanPDF error:', e);
      setScanningPDF(false);
      Alert.alert('Erro', 'Não foi possível processar o PDF: ' + e.message);
    }
  }

  const recsEmUso = recs.filter(r => r.status === 'active' || r.status === 'not_started');
  const recsConcluidos = recs.filter(r => r.status === 'completed');

  function formatDate(d) { if (!d) return ''; return new Date(d).toLocaleDateString('pt-BR', { day: '2-digit', month: 'short', year: 'numeric' }); }

  function calcFimTratamento(rec) {
    if (!rec.created_at || !rec.duration) return null;
    const dur = rec.duration || '';
    const match = dur.match(/([0-9]+)/);
    if (!match) return null;
    const num = parseInt(match[1]);
    const inicio = new Date(rec.created_at);
    if (/m[eê]s/i.test(dur)) inicio.setMonth(inicio.getMonth() + num);
    else if (/semana/i.test(dur)) inicio.setDate(inicio.getDate() + num * 7);
    else inicio.setDate(inicio.getDate() + num);
    return inicio;
  }

  function getDiasNoMes(mesAno) { const [ano, mes] = mesAno.split('-').map(Number); return new Date(ano, mes, 0).getDate(); }
  function getPrimeiroDia(mesAno) { const [ano, mes] = mesAno.split('-').map(Number); return new Date(ano, mes - 1, 1).getDay(); }
  function formatMesAno(mesAno) { const [ano, mes] = mesAno.split('-').map(Number); const nomes = ['Janeiro','Fevereiro','Março','Abril','Maio','Junho','Julho','Agosto','Setembro','Outubro','Novembro','Dezembro']; return nomes[mes - 1] + ' ' + ano; }
  function mudarMes(delta) { const [ano, mes] = mesCal.split('-').map(Number); const nova = new Date(ano, mes - 1 + delta, 1); setMesCal(nova.toISOString().slice(0, 7)); setDiaCal(null); }

  function getInfoDia(mes) {
    const [ano, mesN] = mes.split('-').map(Number);
    const totalDias = getDiasNoMes(mes);
    const prescritos = {}, consultas = {}, fins = {};
    for (let d = 1; d <= totalDias; d++) {
      const dataAtual = new Date(ano, mesN - 1, d); dataAtual.setHours(0, 0, 0, 0);
      recs.forEach(r => { const c = new Date(r.created_at); c.setHours(0,0,0,0); if (c.getTime()===dataAtual.getTime()) { if(!prescritos[d]) prescritos[d]=[]; prescritos[d].push(r); } });
      recs.forEach(r => { if(!r.return_date) return; const ret=new Date(r.return_date+'T00:00:00'); ret.setHours(0,0,0,0); if(ret.getTime()===dataAtual.getTime()) { if(!consultas[d]) consultas[d]=[]; consultas[d].push(r); } });
      recs.forEach(r => { const fim=calcFimTratamento(r); if(!fim) return; fim.setHours(0,0,0,0); if(fim.getTime()===dataAtual.getTime()) { if(!fins[d]) fins[d]=[]; fins[d].push(r); } });
    }
    return { prescritos, consultas, fins };
  }

  const totalDiasCal = getDiasNoMes(mesCal);
  const primeiroDiaCal = getPrimeiroDia(mesCal);
  const infoDias = getInfoDia(mesCal);
  const recsDiaPrescritos = diaCal ? (infoDias.prescritos[diaCal] || []) : [];
  const recsDiaConsultas = diaCal ? (infoDias.consultas[diaCal] || []) : [];
  const recsDiaFins = diaCal ? (infoDias.fins[diaCal] || []) : [];

  function corDia(d) {
    if (infoDias.fins[d]?.length) return 'fim';
    if (infoDias.consultas[d]?.length) return 'consulta';
    if (infoDias.prescritos[d]?.length) return 'prescrito';
    return null;
  }

  return (
    <ScrollView style={styles.scroll} contentContainerStyle={styles.scrollContent}>
      <View style={{ position: 'relative' }}>
        <TouchableOpacity style={{ position: 'absolute', top: 0, right: 0, padding: 8, zIndex: 10 }} onPress={() => setEditando(!editando)}>
          <Ionicons name={editando ? "close-circle-outline" : "settings-outline"} size={24} color="#888" />
        </TouchableOpacity>
        {secao && (
          <TouchableOpacity
            style={{ position: 'absolute', top: 0, left: 0, padding: 8, zIndex: 10, flexDirection: 'row', alignItems: 'center', gap: 4 }}
            onPress={() => setSecao(null)}
          >
            <Ionicons name="chevron-back" size={20} color="#1D9E75" />
            <Text style={{ fontSize: 14, color: '#1D9E75', fontWeight: '600' }}>Voltar</Text>
          </TouchableOpacity>
        )}
        <View style={styles.perfilHeader}>
          <View style={styles.perfilAvatar}>
            <Text style={styles.perfilAvatarText}>{patient?.name?.charAt(0).toUpperCase() || '?'}</Text>
          </View>
          <Text style={styles.perfilNome}>{patient?.name || 'Paciente'}</Text>
          {patient?.email ? <Text style={styles.perfilEmail}>{patient.email}</Text> : null}
          {patient?.whatsapp ? <Text style={styles.perfilEmail}>{patient.whatsapp}</Text> : null}
        </View>
      </View>

      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 10, marginBottom: secao ? 12 : 20 }}>
        {(!secao || secao === 'emuso') && (
          <TouchableOpacity style={[styles.statCard, { minWidth: '45%', flex: 1 }, secao === 'emuso' && styles.statCardAtivo]} onPress={() => setSecao(secao === 'emuso' ? null : 'emuso')}>
            <Text style={[styles.statNum, secao === 'emuso' && { color: '#1D9E75' }]}>{recsEmUso.length}</Text>
            <Text style={styles.statLabel}>Em uso</Text>
          </TouchableOpacity>
        )}
        {(!secao || secao === 'concluidos') && (
          <TouchableOpacity style={[styles.statCard, { minWidth: '45%', flex: 1 }, secao === 'concluidos' && styles.statCardAtivo]} onPress={() => setSecao(secao === 'concluidos' ? null : 'concluidos')}>
            <Text style={[styles.statNum, secao === 'concluidos' && { color: '#1D9E75' }]}>{recsConcluidos.length}</Text>
            <Text style={styles.statLabel}>Concluídos</Text>
          </TouchableOpacity>
        )}
        {(!secao || secao === 'calendario') && (
          <TouchableOpacity style={[styles.statCard, { minWidth: '30%', flex: 1 }, secao === 'calendario' && styles.statCardAtivo]} onPress={() => setSecao(secao === 'calendario' ? null : 'calendario')}>
            <Ionicons name="calendar-outline" size={22} color={secao === 'calendario' ? '#1D9E75' : '#666'} style={{ marginBottom: 4 }} />
            <Text style={styles.statLabel}>Agenda</Text>
          </TouchableOpacity>
        )}
        {(!secao || secao === 'exames') && (
          <TouchableOpacity style={[styles.statCard, { minWidth: '30%', flex: 1 }, secao === 'exames' && styles.statCardAtivo]} onPress={() => setSecao(secao === 'exames' ? null : 'exames')}>
            <Ionicons name="flask-outline" size={22} color={secao === 'exames' ? '#1D9E75' : '#666'} style={{ marginBottom: 4 }} />
            <Text style={styles.statLabel}>Exames</Text>
          </TouchableOpacity>
        )}
        {(!secao || secao === 'armario') && (
          <TouchableOpacity style={[styles.statCard, { minWidth: '30%', flex: 1 }, secao === 'armario' && styles.statCardAtivo]} onPress={() => setSecao(secao === 'armario' ? null : 'armario')}>
            <Ionicons name="medical-outline" size={22} color={secao === 'armario' ? '#1D9E75' : '#666'} style={{ marginBottom: 4 }} />
            <Text style={styles.statLabel}>Meus Rem.</Text>
          </TouchableOpacity>
        )}
      </View>

      {secao === 'emuso' && (
        <View style={{ marginBottom: 16 }}>
          <Text style={styles.sectionTitlePerfil}>Tratamentos ativos</Text>
          {recsEmUso.length === 0 ? <Text style={styles.perfilEmpty}>Nenhum tratamento ativo</Text>
            : recsEmUso.map(r => {
              const fim = calcFimTratamento(r);
              return (
                <View key={r.id} style={styles.perfilRecCard}>
                  <Text style={styles.perfilRecNome}>{r.products?.name || 'Produto'}</Text>
                  <Text style={styles.perfilRecMedico}>Dr(a). {r.doctors?.name}</Text>
                  {r.dosage ? <Text style={styles.perfilRecDetalhe}>Posologia: {r.dosage}</Text> : null}
                  {r.frequency ? <Text style={styles.perfilRecDetalhe}>Frequência: {r.frequency}</Text> : null}
                  {r.duration ? <Text style={styles.perfilRecDetalhe}>Duração: {r.duration}</Text> : null}
                  <View style={styles.perfilRecFimRow}>
                    <Text style={styles.perfilRecFimLabel}>Início: {formatDate(r.created_at)}</Text>
                    {fim && <Text style={styles.perfilRecFim}>Fim previsto: {formatDate(fim)}</Text>}
                  </View>
                </View>
              );
            })}
        </View>
      )}

      {secao === 'concluidos' && (
        <View style={{ marginBottom: 16 }}>
          <Text style={styles.sectionTitlePerfil}>Tratamentos concluídos</Text>
          {recsConcluidos.length === 0 ? <Text style={styles.perfilEmpty}>Nenhum tratamento concluído</Text>
            : recsConcluidos.map(r => (
              <View key={r.id} style={[styles.perfilRecCard, { opacity: 0.85 }]}>
                <Text style={styles.perfilRecNome}>{r.products?.name || 'Produto'}</Text>
                <Text style={styles.perfilRecMedico}>Dr(a). {r.doctors?.name}</Text>
                <View style={styles.perfilRecFimRow}>
                  <Text style={styles.perfilRecFimLabel}>Início: {formatDate(r.created_at)}</Text>
                  <Text style={[styles.perfilRecFim, { color: '#999' }]}>Encerrado: {formatDate(r.updated_at || r.created_at)}</Text>
                </View>
              </View>
            ))}
        </View>
      )}

      {secao === 'calendario' && (
        <View style={{ backgroundColor: 'white', borderRadius: 16, padding: 16, marginBottom: 16, shadowColor: '#000', shadowOpacity: 0.04, shadowRadius: 8, elevation: 2 }}>
          <View style={styles.calNavRow}>
            <TouchableOpacity onPress={() => mudarMes(-1)} style={styles.calNavBtn}><Text style={styles.calNavText}>‹</Text></TouchableOpacity>
            <Text style={styles.calTitulo}>{formatMesAno(mesCal)}</Text>
            <TouchableOpacity onPress={() => mudarMes(1)} style={styles.calNavBtn}><Text style={styles.calNavText}>›</Text></TouchableOpacity>
          </View>
          <View style={[styles.calLegendaRow, { marginBottom: 8 }]}>
            <View style={styles.calLegendaItem}><View style={[styles.calLegendaDot, { backgroundColor: '#1D9E75' }]} /><Text style={styles.calLegendaText}>Prescrito</Text></View>
            <View style={styles.calLegendaItem}><View style={[styles.calLegendaDot, { backgroundColor: '#f59e0b' }]} /><Text style={styles.calLegendaText}>Consulta</Text></View>
            <View style={styles.calLegendaItem}><View style={[styles.calLegendaDot, { backgroundColor: '#ef4444' }]} /><Text style={styles.calLegendaText}>Fim tratamento</Text></View>
          </View>
          <View style={styles.calSemana}>
            {['D','S','T','Q','Q','S','S'].map((d, i) => <Text key={i} style={styles.calDiaSemana}>{d}</Text>)}
          </View>
          <View style={styles.calGrid}>
            {Array.from({ length: primeiroDiaCal }).map((_, i) => <View key={'e-' + i} style={styles.calCelula} />)}
            {Array.from({ length: totalDiasCal }).map((_, i) => {
              const dia = i + 1;
              const cor = corDia(dia);
              const sel = diaCal === dia;
              const bgCor = cor === 'consulta' ? '#fff7e6' : cor === 'prescrito' ? '#e8f5f0' : cor === 'fim' ? '#fff0f0' : 'transparent';
              const textCor = cor === 'consulta' ? '#f59e0b' : cor === 'prescrito' ? '#1D9E75' : cor === 'fim' ? '#e05555' : '#333';
              const dotCor = cor === 'consulta' ? '#f59e0b' : cor === 'prescrito' ? '#1D9E75' : '#e05555';
              return (
                <TouchableOpacity key={dia} style={[styles.calCelula, cor && { backgroundColor: bgCor, borderRadius: 8 }, sel && styles.calCelulaSelecionada]} onPress={() => cor ? setDiaCal(sel ? null : dia) : null} activeOpacity={cor ? 0.7 : 1}>
                  <Text style={[styles.calDiaNum, cor && { color: textCor, fontWeight: '700' }, sel && styles.calDiaNumSelecionado]}>{dia}</Text>
                  {cor && !sel && <View style={[styles.calDot, { backgroundColor: dotCor }]} />}
                </TouchableOpacity>
              );
            })}
          </View>
          {diaCal && (
            <View style={{ marginTop: 12 }}>
              <View style={styles.subSecaoTabs}>
                {[{ key: 'prescritos', label: 'Prescritos', count: recsDiaPrescritos.length }, { key: 'consultas', label: 'Consultas', count: recsDiaConsultas.length }, { key: 'fim', label: 'Fim trat.', count: recsDiaFins.length }].map(s => (
                  <TouchableOpacity key={s.key} style={[styles.subSecaoTab, subSecaoDia === s.key && styles.subSecaoTabAtiva]} onPress={() => setSubSecaoDia(s.key)}>
                    <Text style={[styles.subSecaoTabText, subSecaoDia === s.key && styles.subSecaoTabTextAtiva]}>{s.label} {s.count > 0 ? `(${s.count})` : ''}</Text>
                  </TouchableOpacity>
                ))}
              </View>
              {subSecaoDia === 'prescritos' && (recsDiaPrescritos.length === 0 ? <Text style={styles.perfilEmpty}>Nenhuma prescrição neste dia</Text> : recsDiaPrescritos.map(r => <View key={r.id} style={styles.perfilRecCard}><Text style={styles.perfilRecNome}>{r.products?.name || 'Produto'}</Text><Text style={styles.perfilRecMedico}>Dr(a). {r.doctors?.name}</Text>{r.dosage ? <Text style={styles.perfilRecDetalhe}>{r.dosage}</Text> : null}{r.frequency ? <Text style={styles.perfilRecDetalhe}>{r.frequency}</Text> : null}</View>))}
              {subSecaoDia === 'consultas' && (recsDiaConsultas.length === 0 ? <Text style={styles.perfilEmpty}>Nenhuma consulta neste dia</Text> : recsDiaConsultas.map(r => <View key={r.id} style={styles.perfilRecCard}><Text style={styles.perfilRecNome}>Retorno — Dr(a). {r.doctors?.name}</Text>{r.products?.name ? <Text style={styles.perfilRecDetalhe}>Re: {r.products.name}</Text> : null}</View>))}
              {subSecaoDia === 'fim' && (recsDiaFins.length === 0 ? <Text style={styles.perfilEmpty}>Nenhum tratamento acaba neste dia</Text> : recsDiaFins.map(r => <View key={r.id} style={[styles.perfilRecCard, { borderLeftWidth: 3, borderLeftColor: '#ef4444' }]}><Text style={styles.perfilRecNome}>{r.products?.name || 'Tratamento'}</Text><Text style={styles.perfilRecMedico}>Dr(a). {r.doctors?.name}</Text><Text style={[styles.perfilRecDetalhe, { color: '#ef4444', fontWeight: '600' }]}>Fim do tratamento</Text></View>))}
            </View>
          )}
        </View>
      )}

      {secao === 'exames' && (
        <View style={{ marginBottom: 16 }}>
          {/* Header com botões */}
          <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
            <Text style={styles.sectionTitlePerfil}>Meus exames</Text>
            <View style={{ flexDirection: 'row', gap: 8 }}>
              <TouchableOpacity
                style={{ backgroundColor: '#e8f5f0', borderRadius: 20, paddingHorizontal: 12, paddingVertical: 7, flexDirection: 'row', alignItems: 'center', gap: 5 }}
                onPress={scanPDF}
                disabled={scanningPDF}
              >
                {scanningPDF
                  ? <ActivityIndicator size="small" color="#1D9E75" />
                  : <><Ionicons name="scan-outline" size={15} color="#1D9E75" /><Text style={{ fontSize: 12, color: '#1D9E75', fontWeight: '600' }}>Importar PDF</Text></>
                }
              </TouchableOpacity>
              <TouchableOpacity
                style={{ backgroundColor: '#f0f0f0', borderRadius: 20, paddingHorizontal: 12, paddingVertical: 7, flexDirection: 'row', alignItems: 'center', gap: 5 }}
                onPress={() => setShowAddExame(true)}
              >
                <Ionicons name="add" size={15} color="#666" />
                <Text style={{ fontSize: 12, color: '#666', fontWeight: '600' }}>Manual</Text>
              </TouchableOpacity>
            </View>
          </View>

          {/* Barra de busca */}
          {exames.length > 0 && (
            <View style={{ backgroundColor: 'white', borderRadius: 12, flexDirection: 'row', alignItems: 'center', paddingHorizontal: 12, paddingVertical: 8, marginBottom: 10, borderWidth: 0.5, borderColor: '#e0e0e0' }}>
              <Ionicons name="search-outline" size={16} color="#bbb" style={{ marginRight: 8 }} />
              <TextInput
                style={{ flex: 1, fontSize: 13, color: '#0f1f1a' }}
                placeholder="Buscar exame ou valor..."
                placeholderTextColor="#bbb"
                value={filtroExame}
                onChangeText={setFiltroExame}
              />
              {filtroExame ? <TouchableOpacity onPress={() => setFiltroExame('')}><Ionicons name="close-circle" size={16} color="#bbb" /></TouchableOpacity> : null}
            </View>
          )}

          {exames.length === 0 ? (
            <View style={{ backgroundColor: 'white', borderRadius: 14, padding: 28, alignItems: 'center' }}>
              <Ionicons name="flask-outline" size={40} color="#c8e6d8" style={{ marginBottom: 10 }} />
              <Text style={{ fontSize: 14, fontWeight: '600', color: '#888', marginBottom: 6 }}>Nenhum exame ainda</Text>
              <Text style={{ fontSize: 12, color: '#bbb', textAlign: 'center', marginBottom: 16, lineHeight: 17 }}>Importe um PDF do Einstein, Fleury ou Sabin e a IA extrai todos os valores automaticamente.</Text>
              <TouchableOpacity
                style={{ backgroundColor: '#1D9E75', borderRadius: 12, paddingHorizontal: 20, paddingVertical: 10, flexDirection: 'row', alignItems: 'center', gap: 8 }}
                onPress={scanPDF}
                disabled={scanningPDF}
              >
                {scanningPDF ? <ActivityIndicator size="small" color="white" /> : <><Ionicons name="scan-outline" size={16} color="white" /><Text style={{ color: 'white', fontWeight: '700', fontSize: 13 }}>Importar PDF do laboratório</Text></>}
              </TouchableOpacity>
            </View>
          ) : (
            exames.map(exame => (
              <ExameCard key={exame.id} exame={exame} filtroExame={filtroExame} onRemover={removerExame} />
            ))
          )}
        </View>
      )}

      {secao === 'armario' && (
        <View style={{ marginBottom: 16 }}>
          <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
            <Text style={styles.sectionTitlePerfil}>Meus remédios</Text>
            <View style={{ flexDirection: 'row', gap: 8 }}>
              <TouchableOpacity
                style={{ backgroundColor: '#e8f5f0', borderRadius: 20, paddingHorizontal: 12, paddingVertical: 7, flexDirection: 'row', alignItems: 'center', gap: 5 }}
                onPress={identificarRemedioPorFoto}
                disabled={armIdentificando}
              >
                {armIdentificando
                  ? <ActivityIndicator size="small" color="#1D9E75" />
                  : <><Ionicons name="camera-outline" size={15} color="#1D9E75" /><Text style={{ fontSize: 12, color: '#1D9E75', fontWeight: '600' }}>Por foto</Text></>
                }
              </TouchableOpacity>
              <TouchableOpacity
                style={{ backgroundColor: '#f0f0f0', borderRadius: 20, paddingHorizontal: 12, paddingVertical: 7, flexDirection: 'row', alignItems: 'center', gap: 5 }}
                onPress={() => setShowAddArmario(true)}
              >
                <Ionicons name="add" size={15} color="#666" />
                <Text style={{ fontSize: 12, color: '#666', fontWeight: '600' }}>Manual</Text>
              </TouchableOpacity>
            </View>
          </View>



          {armario.length === 0 ? (
            <View style={{ backgroundColor: 'white', borderRadius: 14, padding: 28, alignItems: 'center' }}>
              <Ionicons name="medical-outline" size={40} color="#c8e6d8" style={{ marginBottom: 10 }} />
              <Text style={{ fontSize: 14, fontWeight: '600', color: '#888', marginBottom: 6 }}>Nenhum remédio ainda</Text>
              <Text style={{ fontSize: 12, color: '#bbb', textAlign: 'center', marginBottom: 16, lineHeight: 17 }}>
                Cadastre os remédios que você tem em casa. Tire uma foto da caixa e a IA identifica automaticamente.
              </Text>
              <TouchableOpacity
                style={{ backgroundColor: '#1D9E75', borderRadius: 12, paddingHorizontal: 20, paddingVertical: 10, flexDirection: 'row', alignItems: 'center', gap: 8 }}
                onPress={identificarRemedioPorFoto}
              >
                <Ionicons name="camera-outline" size={16} color="white" />
                <Text style={{ color: 'white', fontWeight: '700', fontSize: 13 }}>Fotografar remédio</Text>
              </TouchableOpacity>
            </View>
          ) : (() => {
              const norm = str => (str || '').toLowerCase().trim().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/\s+\d+\s*mg.*$/i, '').trim();
              const grupos = {};
              armario.forEach(item => {
                const key = norm(item.nome);
                if (!grupos[key]) grupos[key] = { ...item, ids: [item.id], count: 1 };
                else { grupos[key].ids.push(item.id); grupos[key].count++; }
              });
              const porCategoria = {};
              Object.values(grupos).forEach(g => {
                const cat = (g.categoria && g.categoria !== 'Outros') ? g.categoria : 'Outros';
                if (!porCategoria[cat]) porCategoria[cat] = [];
                porCategoria[cat].push(g);
              });
              const ordemCats = Object.keys(porCategoria).sort((a, b) => a === 'Outros' ? 1 : b === 'Outros' ? -1 : a.localeCompare(b));
              return ordemCats.map(cat => (
                <ArmarioCategoriaCard key={cat} categoria={cat} itens={porCategoria[cat]} onRemover={removerArmario} />
              ));
            })()}
        </View>
      )}

      {/* Modal Adicionar Remédio no Armário */}
      <Modal visible={showAddArmario} animationType="slide" presentationStyle="pageSheet" onRequestClose={() => setShowAddArmario(false)}>
        <SafeAreaView style={{ flex: 1, backgroundColor: '#f5f7f6' }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 20, paddingVertical: 16, backgroundColor: 'white', borderBottomWidth: 1, borderBottomColor: '#f0f0f0' }}>
            <Text style={{ fontSize: 18, fontWeight: '700', color: '#0f1f1a' }}>Adicionar remédio</Text>
            <TouchableOpacity onPress={() => setShowAddArmario(false)} style={{ padding: 4 }}>
              <Ionicons name="close" size={24} color="#666" />
            </TouchableOpacity>
          </View>
          <ScrollView contentContainerStyle={{ padding: 20 }} keyboardShouldPersistTaps="handled">
            <View style={{ backgroundColor: 'white', borderRadius: 16, padding: 16, marginBottom: 12 }}>
              <Text style={{ fontSize: 12, fontWeight: '600', color: '#888', marginBottom: 4 }}>Nome do remédio *</Text>
              <TextInput
                style={{ backgroundColor: '#f5f5f5', borderRadius: 10, padding: 12, fontSize: 14, color: '#0f1f1a', marginBottom: 12 }}
                value={armNome}
                onChangeText={setArmNome}
                placeholder="Ex: Vitamina D 2000UI, Omeprazol 20mg"
                placeholderTextColor="#999"
              />
              <Text style={{ fontSize: 12, fontWeight: '600', color: '#888', marginBottom: 4 }}>Dosagem</Text>
              <TextInput
                style={{ backgroundColor: '#f5f5f5', borderRadius: 10, padding: 12, fontSize: 14, color: '#0f1f1a', marginBottom: 12 }}
                value={armDosagem}
                onChangeText={setArmDosagem}
                placeholder="Ex: 1 comprimido ao dia"
                placeholderTextColor="#999"
              />
              <View style={{ flexDirection: 'row', gap: 8, marginBottom: 12 }}>
                <View style={{ flex: 1 }}>
                  <Text style={{ fontSize: 12, fontWeight: '600', color: '#888', marginBottom: 4 }}>Quantidade</Text>
                  <TextInput
                    style={{ backgroundColor: '#f5f5f5', borderRadius: 10, padding: 12, fontSize: 14, color: '#0f1f1a' }}
                    value={armQtd}
                    onChangeText={setArmQtd}
                    placeholder="Ex: 30"
                    placeholderTextColor="#999"
                    keyboardType="number-pad"
                  />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={{ fontSize: 12, fontWeight: '600', color: '#888', marginBottom: 4 }}>Unidade</Text>
                  <View style={{ backgroundColor: '#f5f5f5', borderRadius: 10, overflow: 'hidden' }}>
                    {['comprimidos', 'cápsulas', 'mL', 'frascos', 'sachês'].map(u => (
                      <TouchableOpacity
                        key={u}
                        style={{ padding: 10, backgroundColor: armUnidade === u ? '#e8f5f0' : 'transparent' }}
                        onPress={() => setArmUnidade(u)}
                      >
                        <Text style={{ fontSize: 13, color: armUnidade === u ? '#1D9E75' : '#666', fontWeight: armUnidade === u ? '700' : '400' }}>{u}</Text>
                      </TouchableOpacity>
                    ))}
                  </View>
                </View>
              </View>
              <Text style={{ fontSize: 12, fontWeight: '600', color: '#888', marginBottom: 4 }}>Data de validade</Text>
              <TextInput
                style={{ backgroundColor: '#f5f5f5', borderRadius: 10, padding: 12, fontSize: 14, color: '#0f1f1a' }}
                value={armValidade}
                onChangeText={setArmValidade}
                placeholder="AAAA-MM-DD (ex: 2026-12-31)"
                placeholderTextColor="#999"
                keyboardType="numbers-and-punctuation"
              />
            </View>
            <TouchableOpacity
              style={{ backgroundColor: '#1D9E75', borderRadius: 14, padding: 16, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, opacity: armSalvando ? 0.7 : 1 }}
              onPress={salvarArmario}
              disabled={armSalvando}
            >
              {armSalvando ? <ActivityIndicator color="white" size="small" /> : <><Ionicons name="checkmark-circle-outline" size={18} color="white" /><Text style={{ color: 'white', fontWeight: '700', fontSize: 16 }}>Salvar remédio</Text></>}
            </TouchableOpacity>
          </ScrollView>
        </SafeAreaView>
      </Modal>

      {/* Modal Adicionar Exame */}
      <Modal visible={showAddExame} animationType="slide" presentationStyle="pageSheet" onRequestClose={() => setShowAddExame(false)}>
        <SafeAreaView style={{ flex: 1, backgroundColor: '#f5f7f6' }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 20, paddingVertical: 16, backgroundColor: 'white', borderBottomWidth: 1, borderBottomColor: '#f0f0f0' }}>
            <Text style={{ fontSize: 18, fontWeight: '700', color: '#0f1f1a' }}>Novo exame</Text>
            <TouchableOpacity onPress={() => setShowAddExame(false)} style={{ padding: 4 }}>
              <Ionicons name="close" size={24} color="#666" />
            </TouchableOpacity>
          </View>
          <ScrollView contentContainerStyle={{ padding: 20 }} keyboardShouldPersistTaps="handled">
            <View style={{ backgroundColor: 'white', borderRadius: 16, padding: 16, marginBottom: 12 }}>
              <Text style={{ fontSize: 12, fontWeight: '600', color: '#888', marginBottom: 4 }}>Nome do exame *</Text>
              <TextInput
                style={{ backgroundColor: '#f5f5f5', borderRadius: 10, padding: 12, fontSize: 14, color: '#0f1f1a', marginBottom: 12 }}
                value={novoExameNome}
                onChangeText={setNovoExameNome}
                placeholder="Ex: Hemograma, Vitaminas, TSH"
                placeholderTextColor="#999"
              />
              <Text style={{ fontSize: 12, fontWeight: '600', color: '#888', marginBottom: 4 }}>Laboratório</Text>
              <TextInput
                style={{ backgroundColor: '#f5f5f5', borderRadius: 10, padding: 12, fontSize: 14, color: '#0f1f1a' }}
                value={novoExameLab}
                onChangeText={setNovoExameLab}
                placeholder="Ex: Einstein, Fleury, Sabin"
                placeholderTextColor="#999"
              />
            </View>
            <View style={{ backgroundColor: 'white', borderRadius: 16, padding: 16, marginBottom: 12 }}>
              <Text style={{ fontSize: 14, fontWeight: '700', color: '#0f1f1a', marginBottom: 12 }}>Itens do exame</Text>
              {novoExameItens.map((item, idx) => (
                <View key={idx} style={{ backgroundColor: '#f9fdfc', borderRadius: 12, padding: 12, marginBottom: 10, borderWidth: 1, borderColor: '#e8f5f0' }}>
                  <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
                    <Text style={{ fontSize: 12, fontWeight: '700', color: '#1D9E75' }}>Item {idx + 1}</Text>
                    {novoExameItens.length > 1 && (
                      <TouchableOpacity onPress={() => removeItemExame(idx)}>
                        <Ionicons name="close-circle" size={18} color="#e05555" />
                      </TouchableOpacity>
                    )}
                  </View>
                  <TextInput
                    style={{ backgroundColor: 'white', borderRadius: 8, padding: 10, fontSize: 13, color: '#0f1f1a', marginBottom: 8, borderWidth: 1, borderColor: '#eee' }}
                    value={item.nome}
                    onChangeText={v => updateItemExame(idx, 'nome', v)}
                    placeholder="Nome (ex: Vitamina D, TSH, Hemoglobina)"
                    placeholderTextColor="#bbb"
                  />
                  <View style={{ flexDirection: 'row', gap: 8, marginBottom: 8 }}>
                    <View style={{ flex: 1 }}>
                      <Text style={{ fontSize: 10, color: '#888', marginBottom: 3 }}>Resultado</Text>
                      <TextInput
                        style={{ backgroundColor: 'white', borderRadius: 8, padding: 10, fontSize: 14, color: '#0f1f1a', fontWeight: '700', borderWidth: 1, borderColor: '#eee', textAlign: 'center' }}
                        value={item.resultado}
                        onChangeText={v => updateItemExame(idx, 'resultado', v)}
                        placeholder="45"
                        placeholderTextColor="#bbb"
                        keyboardType="decimal-pad"
                      />
                    </View>
                    <View style={{ flex: 1 }}>
                      <Text style={{ fontSize: 10, color: '#888', marginBottom: 3 }}>Unidade</Text>
                      <TextInput
                        style={{ backgroundColor: 'white', borderRadius: 8, padding: 10, fontSize: 13, color: '#0f1f1a', borderWidth: 1, borderColor: '#eee', textAlign: 'center' }}
                        value={item.unidade}
                        onChangeText={v => updateItemExame(idx, 'unidade', v)}
                        placeholder="ng/mL"
                        placeholderTextColor="#bbb"
                      />
                    </View>
                  </View>
                  <View style={{ flexDirection: 'row', gap: 8 }}>
                    <View style={{ flex: 1 }}>
                      <Text style={{ fontSize: 10, color: '#888', marginBottom: 3 }}>Ref. mínimo</Text>
                      <TextInput
                        style={{ backgroundColor: 'white', borderRadius: 8, padding: 10, fontSize: 13, color: '#0f1f1a', borderWidth: 1, borderColor: '#eee', textAlign: 'center' }}
                        value={item.refMin}
                        onChangeText={v => updateItemExame(idx, 'refMin', v)}
                        placeholder="30"
                        placeholderTextColor="#bbb"
                        keyboardType="decimal-pad"
                      />
                    </View>
                    <View style={{ flex: 1 }}>
                      <Text style={{ fontSize: 10, color: '#888', marginBottom: 3 }}>Ref. máximo</Text>
                      <TextInput
                        style={{ backgroundColor: 'white', borderRadius: 8, padding: 10, fontSize: 13, color: '#0f1f1a', borderWidth: 1, borderColor: '#eee', textAlign: 'center' }}
                        value={item.refMax}
                        onChangeText={v => updateItemExame(idx, 'refMax', v)}
                        placeholder="100"
                        placeholderTextColor="#bbb"
                        keyboardType="decimal-pad"
                      />
                    </View>
                  </View>
                </View>
              ))}
              <TouchableOpacity
                style={{ backgroundColor: '#f0f9f5', borderRadius: 10, padding: 12, alignItems: 'center', borderWidth: 1, borderColor: '#c8e6d8' }}
                onPress={addItemExame}
              >
                <Text style={{ color: '#1D9E75', fontWeight: '600', fontSize: 13 }}>+ Adicionar item</Text>
              </TouchableOpacity>
            </View>
            <TouchableOpacity
              style={{ backgroundColor: '#1D9E75', borderRadius: 14, padding: 16, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8 }}
              onPress={salvarExame}
            >
              <Ionicons name="checkmark-circle-outline" size={18} color="white" />
              <Text style={{ color: 'white', fontWeight: '700', fontSize: 16 }}>Salvar exame</Text>
            </TouchableOpacity>
          </ScrollView>
        </SafeAreaView>
      </Modal>

      <Modal visible={editando} animationType="slide" presentationStyle="pageSheet" onRequestClose={() => setEditando(false)}>
        <SafeAreaView style={{ flex: 1, backgroundColor: '#f5f7f6' }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 20, paddingVertical: 16, backgroundColor: 'white', borderBottomWidth: 1, borderBottomColor: '#f0f0f0' }}>
            <Text style={{ fontSize: 18, fontWeight: '700', color: '#0f1f1a' }}>Configurações</Text>
            <TouchableOpacity onPress={() => setEditando(false)} style={{ padding: 4 }}><Ionicons name="close" size={24} color="#666" /></TouchableOpacity>
          </View>
          <ScrollView contentContainerStyle={{ padding: 20 }} keyboardShouldPersistTaps="handled">
            <View style={{ alignItems: 'center', marginBottom: 24 }}>
              <View style={[styles.perfilAvatar, { width: 80, height: 80, borderRadius: 40 }]}>
                <Text style={[styles.perfilAvatarText, { fontSize: 32 }]}>{patient?.name?.charAt(0)?.toUpperCase() || '?'}</Text>
              </View>
            </View>
            <View style={styles.card}>
              <Text style={[styles.cardTitle, { marginBottom: 14 }]}>Dados pessoais</Text>
              <Text style={styles.label}>Nome</Text>
              <TextInput style={[styles.input, { marginBottom: 12 }]} value={editNome} onChangeText={setEditNome} placeholderTextColor="#999" placeholder="Seu nome completo" />
              <Text style={styles.label}>WhatsApp</Text>
              <TextInput style={[styles.input, { marginBottom: 12 }]} value={editTel} onChangeText={setEditTel} placeholderTextColor="#999" placeholder="(11) 99999-9999" keyboardType="phone-pad" />
              <Text style={styles.label}>CEP {cepLoading ? <Text style={{ color: '#1D9E75', fontSize: 11 }}>  Buscando...</Text> : null}</Text>
              <TextInput style={[styles.input, { marginBottom: 8 }]} value={editCep} onChangeText={v => { const d=v.replace(/[^0-9]/g,'').slice(0,8); const fmt=d.length>5?d.slice(0,5)+'-'+d.slice(5):d; setEditCep(fmt); if(d.length===8) buscarCepEdit(d); }} placeholder="00000-000" placeholderTextColor="#999" keyboardType="number-pad" maxLength={9} />
              <TextInput style={[styles.input, { marginBottom: 8 }]} value={editRua} onChangeText={setEditRua} placeholder="Rua" placeholderTextColor="#999" />
              <View style={{ flexDirection: 'row', gap: 8, marginBottom: 8 }}>
                <TextInput style={[styles.input, { width: 80 }]} value={editNumero} onChangeText={setEditNumero} placeholder="Nº" placeholderTextColor="#999" keyboardType="number-pad" />
                <TextInput style={[styles.input, { flex: 1 }]} value={editCompl} onChangeText={setEditCompl} placeholder="Complemento" placeholderTextColor="#999" />
              </View>
              <TextInput style={[styles.input, { marginBottom: 8 }]} value={editBairro} onChangeText={setEditBairro} placeholder="Bairro" placeholderTextColor="#999" />
              <View style={{ flexDirection: 'row', gap: 8, marginBottom: 8 }}>
                <TextInput style={[styles.input, { flex: 1 }]} value={editCidade} onChangeText={setEditCidade} placeholder="Cidade" placeholderTextColor="#999" />
                <TextInput style={[styles.input, { width: 60 }]} value={editEstado} onChangeText={setEditEstado} placeholder="UF" placeholderTextColor="#999" maxLength={2} autoCapitalize="characters" />
              </View>
              <Text style={[styles.label, { color: '#bbb', marginTop: 4 }]}>Email</Text>
              <View style={[styles.input, { marginBottom: 4, backgroundColor: '#f0f0f0' }]}><Text style={{ fontSize: 14, color: '#aaa' }}>{patient?.email || '—'}</Text></View>
              <Text style={{ fontSize: 11, color: '#bbb', marginBottom: 4 }}>Email não pode ser alterado</Text>
            </View>
            <TouchableOpacity style={[styles.btnComprar, { flexDirection: 'row', justifyContent: 'center', gap: 8, marginBottom: 16 }]} onPress={async () => { await salvarDados(); setEditando(false); }} disabled={salvando}>
              {salvando ? <ActivityIndicator color="white" size="small" /> : <><Ionicons name="checkmark-circle-outline" size={18} color="white" /><Text style={styles.btnComprarText}>Salvar alterações</Text></>}
            </TouchableOpacity>
            <TouchableOpacity style={styles.logoutBtnPerfil} onPress={() => { setEditando(false); onLogout(); }}>
              <Ionicons name="log-out-outline" size={18} color="#e05555" style={{ marginRight: 6 }} />
              <Text style={styles.logoutBtnText}>Sair da conta</Text>
            </TouchableOpacity>
          </ScrollView>
        </SafeAreaView>
      </Modal>
    </ScrollView>
  );
}

// ─── ABA DIETA ────────────────────────────────────────────────────────────────
function TabDieta({ patient }) {
  const [planos, setPlanos] = useState([]);
  const [loading, setLoading] = useState(true);
  const [planoAtivo, setPlanoAtivo] = useState(0);
  const [diaAtivo, setDiaAtivo] = useState(null);
  const DIAS = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb'];
  const REFEICOES = ['cafe_manha', 'lanche_manha', 'almoco', 'lanche_tarde', 'jantar', 'ceia'];
  const REFEICOES_LABEL = { cafe_manha: 'Café da manhã', lanche_manha: 'Lanche da manhã', almoco: 'Almoço', lanche_tarde: 'Lanche da tarde', jantar: 'Jantar', ceia: 'Ceia' };

  useEffect(() => {
    if (!patient?.id) { setLoading(false); return; }
    async function loadDieta() {
      try {
        let ids = [patient.id];
        if (patient.email) { const { data: pats } = await sb.from('patients').select('id').ilike('email', patient.email); if (pats?.length) ids = [...new Set([...ids, ...pats.map(p => p.id)])]; }
        const { data } = await sb.from('meal_plans').select('*, meal_plan_items(*), doctors(name, specialty)').in('patient_id', ids).order('created_at', { ascending: false });
        if (data?.length > 0) { const dias = [...new Set((data[0].meal_plan_items || []).map(i => i.day_of_week))].sort(); if (dias.length) setDiaAtivo(dias[0]); }
        setPlanos(data || []);
      } catch(e) {
        console.error('Erro ao carregar dieta:', e);
      } finally {
        setLoading(false);
      }
    }
    loadDieta();
  }, [patient?.id]);

  if (loading) return <ActivityIndicator color="#1D9E75" style={{ marginTop: 40 }} />;
  const plano = planos[planoAtivo];

  return (
    <ScrollView style={styles.scroll} contentContainerStyle={styles.scrollContent} showsVerticalScrollIndicator={false}>
      <View style={styles.pageHeader}>
        <Text style={styles.pageGreeting}>Plano alimentar</Text>
        <Text style={styles.pageSubtitle}>Orientações do seu nutricionista</Text>
      </View>
      {planos.length === 0 ? (
        <View style={styles.emptyContainer}>
          <Text style={styles.emptyTitle}>Nenhum plano ainda</Text>
          <Text style={styles.emptyDesc}>Quando seu nutricionista criar um plano alimentar, ele aparecerá aqui.</Text>
        </View>
      ) : (
        <>
          {planos.length > 1 && (
            <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginBottom: 12 }} contentContainerStyle={{ gap: 8 }}>
              {planos.map((p, i) => (
                <TouchableOpacity key={p.id} style={[styles.mesBadge, planoAtivo === i && styles.mesBadgeAtivo]} onPress={() => { setPlanoAtivo(i); const dias=[...new Set((p.meal_plan_items||[]).map(it=>it.day_of_week))].sort(); setDiaAtivo(dias[0]||null); }}>
                  <Text style={[styles.mesBadgeText, planoAtivo === i && styles.mesBadgeTextAtivo]}>{p.title || 'Plano ' + (i+1)}</Text>
                </TouchableOpacity>
              ))}
            </ScrollView>
          )}
          {plano && (
            <View style={styles.dietaCard}>
              <View style={styles.dietaHeader}>
                <Text style={styles.dietaTitulo}>{plano.title || 'Plano alimentar'}</Text>
                <Text style={styles.dietaMedico}>Dr(a). {plano.doctors?.name?.split(' ').slice(0,2).join(' ')}</Text>
                <Text style={styles.dietaData}>{new Date(plano.created_at).toLocaleDateString('pt-BR', { day: '2-digit', month: 'short' })}</Text>
              </View>
              <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginVertical: 12 }} contentContainerStyle={{ gap: 8 }}>
                {[...new Set((plano.meal_plan_items||[]).map(i => i.day_of_week))].sort().map(dia => (
                  <TouchableOpacity key={dia} style={[styles.diaDietaBtn, diaAtivo === dia && styles.diaDietaBtnAtivo]} onPress={() => setDiaAtivo(dia)}>
                    <Text style={[styles.diaDietaText, diaAtivo === dia && styles.diaDietaTextAtivo]}>{DIAS[dia] || 'Dia ' + dia}</Text>
                  </TouchableOpacity>
                ))}
              </ScrollView>
              {(plano.meal_plan_items||[]).filter(item => item.day_of_week === diaAtivo).sort((a,b) => REFEICOES.indexOf(a.meal_time) - REFEICOES.indexOf(b.meal_time)).map((item, i) => (
                <View key={i} style={styles.refeicaoCard}>
                  <Text style={styles.refeicaoLabel}>{REFEICOES_LABEL[item.meal_time] || item.meal_time}</Text>
                  {item.foods ? <Text style={styles.refeicaoAlimento}>{item.foods}</Text> : null}
                  {item.quantities ? <Text style={styles.refeicaoQtd}>{item.quantities}</Text> : null}
                  {item.supplements ? <View style={styles.suplementoTag}><Text style={styles.suplementoText}>{item.supplements}</Text></View> : null}
                </View>
              ))}
            </View>
          )}
        </>
      )}
    </ScrollView>
  );
}

// ─── STYLES ───────────────────────────────────────────────────────────────────
const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: '#0f1f1a' },
  container: { flex: 1, backgroundColor: '#f5f7f6' },
  flex: { flex: 1, backgroundColor: '#f5f7f6' },
  loadingContainer: { flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: '#f5f7f6' },
  content: { flex: 1 },
  scroll: { flex: 1, backgroundColor: '#f5f7f6' },
  scrollContent: { padding: 20, paddingBottom: 32 },
  bottomNav: { flexDirection: 'row', backgroundColor: 'white', borderTopWidth: 1, borderTopColor: '#eee', paddingBottom: Platform.OS === 'ios' ? 20 : 8, paddingTop: 10 },
  navItem: { flex: 1, alignItems: 'center', gap: 4 },
  navLabel: { fontSize: 11, color: '#aaa', fontWeight: '500' },
  navLabelActive: { color: '#1D9E75', fontWeight: '700' },
  navIndicator: { width: 4, height: 4, borderRadius: 2, backgroundColor: '#1D9E75' },
  pageHeader: { marginBottom: 20 },
  pageGreeting: { fontSize: 22, fontWeight: '700', color: '#0f1f1a' },
  pageSubtitle: { fontSize: 13, color: '#6b9e8e', marginTop: 2 },
  pageHeaderSimples: { padding: 20, paddingBottom: 12, backgroundColor: 'white', borderBottomWidth: 1, borderBottomColor: '#eee', flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  pageTitle: { fontSize: 20, fontWeight: '700', color: '#0f1f1a' },
  pageSubtitleSmall: { fontSize: 12, color: '#999', marginTop: 2 },
  card: { backgroundColor: 'white', borderRadius: 16, padding: 16, marginBottom: 12, shadowColor: '#000', shadowOpacity: 0.04, shadowRadius: 8, elevation: 2 },
  cardTitle: { fontSize: 15, fontWeight: '700', color: '#0f1f1a' },
  label: { fontSize: 12, fontWeight: '600', color: '#888', marginBottom: 4 },
  input: { backgroundColor: '#f5f5f5', borderRadius: 10, padding: 12, fontSize: 14, color: '#0f1f1a' },
  emptyContainer: { alignItems: 'center', paddingVertical: 60 },
  emptyTitle: { fontSize: 16, fontWeight: '600', color: '#444', marginBottom: 6 },
  emptyDesc: { fontSize: 13, color: '#999', textAlign: 'center', paddingHorizontal: 32 },
  statusBadge: { paddingHorizontal: 10, paddingVertical: 4, borderRadius: 20 },
  statusBadgeText: { fontSize: 11, fontWeight: '700' },
  farmaciaBtn: { paddingHorizontal: 12, paddingVertical: 7, borderRadius: 8, borderWidth: 1, borderColor: '#e0e0e0', backgroundColor: '#fafafa' },
  farmaciaBtnDestaque: { backgroundColor: '#1D9E75', borderColor: '#1D9E75' },
  farmaciaBtnText: { fontSize: 12, color: '#444', fontWeight: '500' },
  farmaciaBtnTextDestaque: { color: 'white', fontWeight: '700' },
  lembreteCard: { backgroundColor: 'white', borderRadius: 14, padding: 16, marginBottom: 10, shadowColor: '#000', shadowOpacity: 0.04, shadowRadius: 6, elevation: 1 },
  lembreteRow: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  lembreteInfo: { flex: 1 },
  lembreteNome: { fontSize: 15, fontWeight: '700', color: '#0f1f1a' },
  lembreteInstrucao: { fontSize: 12, color: '#888', marginTop: 2 },
  novoLembreteBtn: { backgroundColor: '#f0f9f5', borderRadius: 12, padding: 14, alignItems: 'center', marginTop: 8, borderWidth: 1, borderColor: '#c8e6d8' },
  novoLembreteBtnText: { color: '#1D9E75', fontWeight: '700', fontSize: 14 },
  lembreteForm: { backgroundColor: 'white', borderRadius: 16, padding: 16, marginTop: 12, shadowColor: '#000', shadowOpacity: 0.04, shadowRadius: 8, elevation: 2 },
  lembreteFormLabel: { fontSize: 11, fontWeight: '700', color: '#888', textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 8 },
  tipoOpcao: { flexDirection: 'row', alignItems: 'center', padding: 14, borderRadius: 12, borderWidth: 1, borderColor: '#eee', marginBottom: 8, backgroundColor: 'white' },
  tipoOpcaoAtiva: { borderColor: '#1D9E75', backgroundColor: '#f0f9f5' },
  tipoOpcaoInfo: { flex: 1 },
  tipoOpcaoLabel: { fontSize: 14, fontWeight: '600', color: '#0f1f1a' },
  tipoOpcaoDesc: { fontSize: 12, color: '#999', marginTop: 2 },
  produtoPickerList: { backgroundColor: 'white', borderRadius: 10, borderWidth: 1, borderColor: '#eee', marginTop: 4, maxHeight: 200, overflow: 'hidden' },
  produtoPickerItem: { flexDirection: 'row', justifyContent: 'space-between', padding: 12, borderBottomWidth: 1, borderBottomColor: '#f5f5f5' },
  produtoPickerItemAtivo: { backgroundColor: '#f0f9f5' },
  produtoPickerItemText: { fontSize: 14, color: '#333' },
  horaRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 10 },
  horaBadge: { paddingHorizontal: 12, paddingVertical: 7, borderRadius: 20, backgroundColor: '#f0f0f0', borderWidth: 1.5, borderColor: 'transparent' },
  horaBadgeAtivo: { backgroundColor: '#1D9E75', borderColor: '#1D9E75' },
  horaBadgeText: { fontSize: 13, color: '#666', fontWeight: '500' },
  horaBadgeTextAtivo: { color: 'white', fontWeight: '700' },
  perfilHeader: { alignItems: 'center', marginBottom: 24 },
  perfilAvatar: { width: 72, height: 72, borderRadius: 36, backgroundColor: '#e8f5f0', alignItems: 'center', justifyContent: 'center', marginBottom: 12 },
  perfilAvatarText: { fontSize: 28, fontWeight: '700', color: '#1D9E75' },
  perfilNome: { fontSize: 18, fontWeight: '700', color: '#0f1f1a' },
  perfilEmail: { fontSize: 13, color: '#999', marginTop: 4 },
  statsRow: { flexDirection: 'row', gap: 10, marginBottom: 20 },
  statCard: { flex: 1, backgroundColor: 'white', borderRadius: 14, padding: 14, alignItems: 'center', justifyContent: 'center', minHeight: 80 },
  statNum: { fontSize: 24, fontWeight: '800', color: '#0f1f1a' },
  statLabel: { fontSize: 11, color: '#999', marginTop: 2 },
  statCardAtivo: { borderWidth: 1.5, borderColor: '#1D9E75' },
  sectionTitlePerfil: { fontSize: 15, fontWeight: '700', color: '#0f1f1a', marginBottom: 10 },
  perfilEmpty: { color: '#999', fontSize: 13, textAlign: 'center', paddingVertical: 20 },
  perfilRecCard: { backgroundColor: 'white', borderRadius: 12, padding: 14, marginBottom: 8, shadowColor: '#000', shadowOpacity: 0.03, shadowRadius: 6, elevation: 1 },
  perfilRecNome: { fontSize: 15, fontWeight: '700', color: '#0f1f1a', marginBottom: 2 },
  perfilRecMedico: { fontSize: 12, color: '#6b9e8e', marginBottom: 6 },
  perfilRecDetalhe: { fontSize: 12, color: '#666', marginBottom: 2 },
  perfilRecFimRow: { flexDirection: 'row', justifyContent: 'space-between', marginTop: 8, paddingTop: 8, borderTopWidth: 1, borderTopColor: '#f0f0f0', flexWrap: 'wrap', gap: 4 },
  perfilRecFimLabel: { fontSize: 11, color: '#aaa' },
  perfilRecFim: { fontSize: 11, color: '#1D9E75', fontWeight: '600' },
  logoutBtnPerfil: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', backgroundColor: '#fff0f0', borderRadius: 14, padding: 16, marginTop: 8, marginBottom: 24 },
  logoutBtnText: { color: '#e05555', fontWeight: '700', fontSize: 15 },
  bannerAcabando: { backgroundColor: '#fff7e6', borderRadius: 12, padding: 14, marginBottom: 10, flexDirection: 'row', alignItems: 'flex-start', gap: 10, borderLeftWidth: 3, borderLeftColor: '#f59e0b' },
  bannerInfo: { flex: 1 },
  bannerTitulo: { fontSize: 14, fontWeight: '700', color: '#92400e', marginBottom: 4 },
  bannerDesc: { fontSize: 12, color: '#92400e' },
  bannerLink: { fontSize: 12, color: '#f59e0b', fontWeight: '700', textDecorationLine: 'underline' },
  produtoCard: { backgroundColor: 'white', borderRadius: 14, padding: 16, marginBottom: 10, shadowColor: '#000', shadowOpacity: 0.04, shadowRadius: 8, elevation: 2 },
  produtoCardHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 6 },
  produtoCardInfo: { flex: 1, marginRight: 8 },
  produtoCardNome: { fontSize: 15, fontWeight: '700', color: '#0f1f1a' },
  produtoCardMedico: { fontSize: 12, color: '#6b9e8e', marginTop: 2 },
  produtoCardDetalhes: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginBottom: 8 },
  produtoCardDetalhe: { fontSize: 11, color: '#666', backgroundColor: '#f5f5f5', paddingHorizontal: 8, paddingVertical: 3, borderRadius: 6 },
  produtoCardAcoes: { flexDirection: 'row', gap: 8, marginTop: 14, alignItems: 'center' },
  produtoCardAcoesSecundarias: { flexDirection: 'row', alignItems: 'center', marginTop: 10, paddingTop: 10, borderTopWidth: 1, borderTopColor: '#f0f0f0' },
  btnAcaoSeparador: { width: 1, height: 16, backgroundColor: '#e8e8e8' },
  btnAcaoSecundaria: { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 5, paddingVertical: 4 },
  btnAcaoSecundariaText: { fontSize: 13, color: '#bbb', fontWeight: '500' },
  btnEmUso: { flex: 1, backgroundColor: '#e8f5f0', borderRadius: 10, padding: 10, alignItems: 'center' },
  btnEmUsoText: { fontSize: 13, fontWeight: '700', color: '#1D9E75' },
  btnComprar: { flex: 1, backgroundColor: '#1D9E75', borderRadius: 10, padding: 10, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6 },
  btnComprarText: { fontSize: 13, fontWeight: '700', color: 'white' },
  farmaciasBox: { marginTop: 10, flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  produtoCardManip: { borderLeftWidth: 3, borderLeftColor: '#6366f1' },
  produtoCardMeta: { flexDirection: 'row', alignItems: 'center', marginTop: 2 },
  produtoCardData: { fontSize: 11, color: '#bbb' },
  manipBadge: { fontSize: 11, color: '#6366f1', fontWeight: '700', marginBottom: 4 },
  manipBox: { marginTop: 10, backgroundColor: '#f8f8ff', borderRadius: 10, padding: 12 },
  manipComps: { marginBottom: 8 },
  manipCompRow: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 5 },
  manipCompNome: { fontSize: 13, color: '#333', flex: 1 },
  manipCompConc: { fontSize: 13, color: '#1D9E75', fontWeight: '600' },
  manipTabelaRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingHorizontal: 12, paddingVertical: 8, backgroundColor: 'white' },
  manipTabelaLabel: { fontSize: 12, color: '#888', fontWeight: '600' },
  manipTabelaValor: { fontSize: 13, color: '#0f1f1a', fontWeight: '500', maxWidth: '60%', textAlign: 'right' },
  manipFarmacia: { fontSize: 12, color: '#1D9E75', marginTop: 8, fontWeight: '600' },
  manipAguardando: { marginTop: 10, backgroundColor: '#f5f5f5', borderRadius: 8, padding: 10, flexDirection: 'row', alignItems: 'center', justifyContent: 'center' },
  manipAguardandoText: { fontSize: 12, color: '#888' },
  filtrosScroll: { maxHeight: 48, borderBottomWidth: 1, borderBottomColor: '#f0f0f0' },
  filtrosContent: { paddingHorizontal: 16, gap: 8, alignItems: 'center' },
  filtroBtn: { paddingHorizontal: 14, paddingVertical: 7, borderRadius: 20, borderWidth: 1, borderColor: '#ddd', backgroundColor: 'white' },
  filtroBtnAtivo: { backgroundColor: '#1D9E75', borderColor: '#1D9E75' },
  filtroBtnText: { fontSize: 13, color: '#555', fontWeight: '500' },
  filtroBtnTextAtivo: { color: 'white', fontWeight: '700' },
  medicoGrupo: { marginBottom: 12 },
  medicoGrupoHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', backgroundColor: 'white', borderRadius: 12, padding: 14, marginBottom: 2 },
  medicoGrupoLeft: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  medicoAvatar: { width: 38, height: 38, borderRadius: 19, backgroundColor: '#e8f5f0', alignItems: 'center', justifyContent: 'center' },
  medicoAvatarText: { fontSize: 16, fontWeight: '700', color: '#1D9E75' },
  medicoGrupoNome: { fontSize: 14, fontWeight: '700', color: '#0f1f1a' },
  medicoGrupoCount: { fontSize: 11, color: '#999', marginTop: 1 },
  medicoGrupoSeta: { fontSize: 11, color: '#bbb' },
  calTitulo: { fontSize: 15, fontWeight: '700', color: '#0f1f1a', textAlign: 'center' },
  calSemana: { flexDirection: 'row', marginBottom: 6, marginTop: 8 },
  calDiaSemana: { flex: 1, textAlign: 'center', fontSize: 11, fontWeight: '600', color: '#999', textTransform: 'uppercase' },
  calGrid: { flexDirection: 'row', flexWrap: 'wrap' },
  calCelula: { width: '14.28%', aspectRatio: 1, alignItems: 'center', justifyContent: 'center', padding: 2 },
  calCelulaSelecionada: { backgroundColor: '#1D9E75', borderRadius: 8 },
  calDiaNum: { fontSize: 13, color: '#333' },
  calDiaNumSelecionado: { color: 'white', fontWeight: '700' },
  calDot: { width: 4, height: 4, borderRadius: 2, marginTop: 1 },
  calNavRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 },
  calNavBtn: { padding: 8 },
  calNavText: { fontSize: 28, color: '#1D9E75', fontWeight: '300' },
  calLegendaRow: { flexDirection: 'row', gap: 16, marginBottom: 12, flexWrap: 'wrap' },
  calLegendaItem: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  calLegendaDot: { width: 8, height: 8, borderRadius: 4 },
  calLegendaText: { fontSize: 12, color: '#666' },
  subSecaoTabs: { flexDirection: 'row', backgroundColor: '#f0f0f0', borderRadius: 10, padding: 3, marginBottom: 12 },
  subSecaoTab: { flex: 1, paddingVertical: 7, alignItems: 'center', borderRadius: 8 },
  subSecaoTabAtiva: { backgroundColor: 'white' },
  subSecaoTabText: { fontSize: 11, color: '#999', fontWeight: '500', textAlign: 'center' },
  subSecaoTabTextAtiva: { color: '#0f1f1a', fontWeight: '700' },
  homeHeader: { marginBottom: 20 },
  homeSectionTitle: { fontSize: 13, fontWeight: '700', color: '#888', textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 10 },
  scanCardBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', backgroundColor: 'white', borderRadius: 14, padding: 16, marginBottom: 16, shadowColor: '#000', shadowOpacity: 0.04, shadowRadius: 6, elevation: 1, borderWidth: 1, borderColor: '#e8f5f0' },
  scanCardBtnLeft: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  scanCardBtnTitle: { fontSize: 15, fontWeight: '700', color: '#0f1f1a' },
  scanCardBtnSub: { fontSize: 12, color: '#999', marginTop: 1 },
  scanModal: { flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'center', alignItems: 'center' },
  scanModalBox: { backgroundColor: 'white', borderRadius: 20, padding: 32, alignItems: 'center', gap: 12, width: 220 },
  scanModalText: { fontSize: 16, fontWeight: '700', color: '#0f1f1a' },
  scanModalSub: { fontSize: 12, color: '#999' },
  dietaCard: { backgroundColor: 'white', borderRadius: 16, padding: 18, marginBottom: 12, shadowColor: '#000', shadowOpacity: 0.04, shadowRadius: 8, elevation: 2 },
  dietaHeader: { marginBottom: 6 },
  dietaTitulo: { fontSize: 17, fontWeight: '700', color: '#0f1f1a' },
  dietaMedico: { fontSize: 12, color: '#6b9e8e', marginTop: 2 },
  dietaData: { fontSize: 11, color: '#bbb', marginBottom: 12 },
  refeicaoCard: { backgroundColor: '#f8f8f8', borderRadius: 10, padding: 12, marginBottom: 8 },
  refeicaoLabel: { fontSize: 10, fontWeight: '700', color: '#1D9E75', textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 4 },
  refeicaoAlimento: { fontSize: 15, fontWeight: '600', color: '#0f1f1a' },
  refeicaoQtd: { fontSize: 12, color: '#888', marginTop: 2 },
  suplementoTag: { backgroundColor: '#e8f5f0', borderRadius: 6, paddingHorizontal: 8, paddingVertical: 3, marginTop: 6, alignSelf: 'flex-start' },
  suplementoText: { fontSize: 12, color: '#1D9E75', fontWeight: '600' },
  diaDietaBtn: { paddingHorizontal: 18, paddingVertical: 10, borderRadius: 20, backgroundColor: '#f0f0f0', borderWidth: 1.5, borderColor: 'transparent' },
  diaDietaBtnAtivo: { backgroundColor: '#1D9E75', borderColor: '#1D9E75' },
  diaDietaText: { fontSize: 14, fontWeight: '600', color: '#666' },
  diaDietaTextAtivo: { color: 'white', fontWeight: '700' },
  mesBadge: { paddingHorizontal: 14, paddingVertical: 8, borderRadius: 20, backgroundColor: '#f0f0f0' },
  mesBadgeAtivo: { backgroundColor: '#1D9E75' },
  mesBadgeText: { fontSize: 13, color: '#666', fontWeight: '600' },
  mesBadgeTextAtivo: { color: 'white', fontWeight: '700' },
});