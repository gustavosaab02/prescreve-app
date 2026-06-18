import { useState, useEffect, useRef } from 'react';
import { Ionicons } from '@expo/vector-icons';
import {
  View, Text, StyleSheet, TouchableOpacity, ScrollView,
  TextInput, ActivityIndicator, Modal, FlatList,
  SafeAreaView, Platform, Alert, Linking
} from 'react-native';
import * as Notifications from 'expo-notifications';
import { sb } from '../supabase';

const SUPABASE_URL = 'https://iwrfgdfxvyqdkqdtrrxg.supabase.co';
const SUPABASE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Iml3cmZnZGZ4dnlxZGtxZHRycnhnIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzQzNjIxMzEsImV4cCI6MjA4OTkzODEzMX0.kQr7K_W-B2bcEYgQpxIrNFhORyiYT6_SZkfpC4S_AfQ';

// ─── DETECÇÃO DE MEDICAMENTOS CONTROLADOS ────────────────────────────────────
const PALAVRAS_CONTROLADO = [
  'tarja vermelha','tarja preta','controlado','clonazepam','alprazolam',
  'diazepam','lorazepam','bromazepam','midazolam','rivotril','frontal',
  'valium','lexotan','ritalina','concerta','venvanse','vyvanse',
  'metilfenidato','methylphenidate','modafinil','zolpidem','stilnox',
  'morfina','codeína','tramadol','oxicodona','fentanil','buprenorfina',
  'metadona','quetiapina','olanzapina','risperidona','haloperidol',
  'clozapina','carbamazepina','valproato','fenitoína','fenobarbital',
  'isotretinoína','roacutan','anfetamina','dexanfetamina',
];

function isProdutoControlado(nome) {
  if (!nome) return false;
  const lower = nome.toLowerCase();
  return PALAVRAS_CONTROLADO.some(p => lower.includes(p));
}

function getTabs(doctor) {
  const isNutri = /nutri/i.test(doctor?.specialty || '');
  const tabs = [
    { key: 'inicio', label: 'Início', icon: 'home-outline', iconActive: 'home' },
    { key: 'receitar', label: 'Receitar', icon: 'add-circle-outline', iconActive: 'add-circle' },
    { key: 'pacientes', label: 'Pacientes', icon: 'people-outline', iconActive: 'people' },
  ];
  if (isNutri) tabs.push({ key: 'dieta', label: 'Dieta', icon: 'nutrition-outline', iconActive: 'nutrition' });
  tabs.push({ key: 'perfil', label: 'Perfil', icon: 'person-outline', iconActive: 'person' });
  return tabs;
}

export default function DoctorScreen({ user, onLogout }) {
  const [tab, setTab] = useState('inicio');
  const [doctor, setDoctor] = useState(null);
  const [loading, setLoading] = useState(true);
  const [pacienteFicha, setPacienteFicha] = useState(null);
  const notifResponseListener = useRef();

  useEffect(() => {
    if (!user?.id) { setLoading(false); return; }
    sb.from('doctors').select('*').eq('id', user.id).single()
      .then(async ({ data }) => {
        setDoctor(data);
        setLoading(false);
        // Salva expo_push_token do médico para receber notificações de acompanhamento
        try {
          const { status } = await Notifications.getPermissionsAsync();
          if (status === 'granted' && data?.id) {
            const tokenData = await Notifications.getExpoPushTokenAsync({
              projectId: 'e5fec6c1-e462-4753-8b25-7a2f2651f788',
            });
            const expoPushToken = tokenData?.data;
            if (expoPushToken && expoPushToken !== data.expo_push_token) {
              await sb.from('doctors').update({ expo_push_token: expoPushToken }).eq('id', data.id);
            }
          }
        } catch(e) { console.log('Doctor push token error:', e); }
      });
  }, [user]);

  useEffect(() => {
    function abrirWhatsAppDaNotificacao(data) {
      if (!data?.patient_whatsapp) return;
      const num = data.patient_whatsapp.replace(/\D/g, '');
      const numBR = num.startsWith('55') ? num : '55' + num;
      const nomeP = (data.patient_name || 'paciente').split(' ')[0];
      const produto = data.produto || 'o produto';
      let msg = '';
      if (data.type === 'acompanhamento') {
        msg = `Olá ${nomeP}! Tudo bem? Como está se sentindo com ${produto}?`;
      } else if (data.type === 'tratamento_acabando') {
        msg = data.controlado
          ? `Olá ${nomeP}! Seu tratamento com ${produto} está chegando ao fim. Vou emitir uma nova receita para você em breve. 😊`
          : `Olá ${nomeP}! Seu tratamento com ${produto} está acabando. Precisa renovar a prescrição?`;
      }
      if (!msg) return;
      Linking.openURL(`https://wa.me/${numBR}?text=${encodeURIComponent(msg)}`)
        .catch(() => Alert.alert('Erro', 'Não foi possível abrir o WhatsApp.'));
    }

    // Caso o app estava fechado e foi aberto pelo toque na notificação
    Notifications.getLastNotificationResponseAsync().then(response => {
      if (response) abrirWhatsAppDaNotificacao(response.notification.request.content.data);
    });

    // Caso o app estava em background ou foreground
    notifResponseListener.current = Notifications.addNotificationResponseReceivedListener(response => {
      abrirWhatsAppDaNotificacao(response.notification.request.content.data);
    });

    return () => {
      if (notifResponseListener.current) {
        Notifications.removeNotificationSubscription(notifResponseListener.current);
      }
    };
  }, []);

  if (loading) {
    return (
      <View style={styles.loadingContainer}>
        <ActivityIndicator color="#1D9E75" size="large" />
      </View>
    );
  }

  if (pacienteFicha) {
    return <FichaPaciente paciente={pacienteFicha} onBack={() => setPacienteFicha(null)} doctor={doctor} />;
  }

  return (
    <SafeAreaView style={styles.safe}>
      <View style={styles.container}>
        <View style={styles.content}>
          {tab === 'inicio' && <TabInicio doctor={doctor} onLogout={onLogout} onTabChange={setTab} />}
          {tab === 'receitar' && <TabReceitar doctor={doctor} onTabChange={setTab} />}
          {tab === 'pacientes' && <TabPacientes doctor={doctor} onSelectPaciente={setPacienteFicha} />}
          {tab === 'dieta' && /nutri/i.test(doctor?.specialty || '') && <TabDietaMedico doctor={doctor} />}
          {tab === 'perfil' && <TabPerfilMedico doctor={doctor} onLogout={onLogout} />}
        </View>

        <View style={styles.bottomNav}>
          {getTabs(doctor).map(t => (
            <TouchableOpacity key={t.key} style={styles.navItem} onPress={() => setTab(t.key)} activeOpacity={0.7}>
              <Ionicons name={tab === t.key ? t.iconActive : t.icon} size={22} color={tab === t.key ? '#1D9E75' : '#9aaca8'} />
              <Text style={[styles.navLabel, tab === t.key && styles.navLabelActive]}>{t.label}</Text>
            </TouchableOpacity>
          ))}
        </View>
      </View>
    </SafeAreaView>
  );
}

// ─── FICHA DO PACIENTE ────────────────────────────────────────────────────────
function FichaPaciente({ paciente, onBack, doctor }) {
  const [historico, setHistorico] = useState([]);
  const [loading, setLoading] = useState(true);
  const [mesSelecionado, setMesSelecionado] = useState(null);
  const [diaSelecionado, setDiaSelecionado] = useState(null);

  useEffect(() => {
    sb.from('recommendations')
      .select('id, created_at, return_date, notes, products(name), recommendation_items(products(name))')
      .eq('patient_id', paciente.id)
      .order('created_at', { ascending: false })
      .then(({ data }) => {
        setHistorico(data || []);
        setLoading(false);
        if (data && data.length > 0) {
          const primeiraMes = data[0].created_at.slice(0, 7);
          setMesSelecionado(primeiraMes);
        }
      });
  }, []);

  function getProdutosRec(r) {
    if (r.recommendation_items && r.recommendation_items.length > 0) {
      return r.recommendation_items.map(i => i.products?.name).filter(Boolean);
    }
    if (r.products?.name) return [r.products.name];
    try {
      const parsed = JSON.parse(r.notes);
      if (parsed?.__manipulado) return [parsed.nome || 'Fórmula manipulada'];
    } catch(e) {}
    return [];
  }

  function formatDate(d) {
    if (!d) return '';
    return new Date(d).toLocaleDateString('pt-BR', { day: '2-digit', month: 'short', year: 'numeric' });
  }

  function getMeses() {
    const meses = {};
    historico.forEach(r => {
      const mes = r.created_at.slice(0, 7);
      if (!meses[mes]) meses[mes] = 0;
      meses[mes]++;
    });
    return Object.keys(meses).sort((a, b) => b.localeCompare(a));
  }

  function getDiasComConsulta(mes) {
    const dias = {};
    historico
      .filter(r => r.created_at.slice(0, 7) === mes)
      .forEach(r => {
        const dia = new Date(r.created_at).getDate();
        if (!dias[dia]) dias[dia] = [];
        dias[dia].push({ ...r, _tipo: 'consulta' });
      });
    return dias;
  }

  function getDiasRetorno(mes) {
    const dias = {};
    historico
      .filter(r => r.return_date && r.return_date.slice(0, 7) === mes)
      .forEach(r => {
        const dia = new Date(r.return_date).getDate();
        if (!dias[dia]) dias[dia] = [];
        dias[dia].push({ ...r, _tipo: 'retorno' });
      });
    return dias;
  }

  function getDiasNoMes(mesAno) {
    const [ano, mes] = mesAno.split('-').map(Number);
    return new Date(ano, mes, 0).getDate();
  }

  function getPrimeiroDiaSemana(mesAno) {
    const [ano, mes] = mesAno.split('-').map(Number);
    return new Date(ano, mes - 1, 1).getDay();
  }

  function formatMesAno(mesAno) {
    const [ano, mes] = mesAno.split('-').map(Number);
    const nomes = ['Janeiro','Fevereiro','Março','Abril','Maio','Junho','Julho','Agosto','Setembro','Outubro','Novembro','Dezembro'];
    return nomes[mes - 1] + ' ' + ano;
  }

  const meses = getMeses();
  const diasComConsulta = mesSelecionado ? getDiasComConsulta(mesSelecionado) : {};
  const diasRetorno = mesSelecionado ? getDiasRetorno(mesSelecionado) : {};
  const totalDias = mesSelecionado ? getDiasNoMes(mesSelecionado) : 0;
  const primeiroDia = mesSelecionado ? getPrimeiroDiaSemana(mesSelecionado) : 0;
  const recsDiaSelecionado = diaSelecionado
    ? [...(diasComConsulta[diaSelecionado] || []), ...(diasRetorno[diaSelecionado] || [])]
    : [];

  return (
    <SafeAreaView style={styles.safe}>
      <View style={styles.fichaHeader}>
        <TouchableOpacity onPress={onBack} style={styles.backBtn}>
          <Ionicons name="arrow-back" size={20} color="#1D9E75" />
          <Text style={styles.backBtnText}>Voltar</Text>
        </TouchableOpacity>
        <Text style={styles.fichaTitle}>{paciente.name}</Text>
        {paciente.whatsapp ? (
          <TouchableOpacity
            style={styles.waIconBtn}
            onPress={() => {
              const primeiroNome = paciente.name?.split(' ')[0] || 'paciente';
              const ultimosProds = historico.slice(0, 3).map(r => getProdutosRec(r)).flat().filter(Boolean);
              const listaProd = ultimosProds.length > 0 ? ultimosProds.slice(0,2).join(' e ') : 'seu tratamento';
              const msg = `Olá ${primeiroNome}! Tudo bem? Queria saber como você está se sentindo com ${listaProd}. Precisa de algo?`;
              const num = paciente.whatsapp.replace(/\D/g, '');
              const numBR = num.startsWith('55') ? num : '55' + num;
              Linking.openURL('https://wa.me/' + numBR + '?text=' + encodeURIComponent(msg)).catch(() => Alert.alert('Erro', 'Não foi possível abrir o WhatsApp.'));
            }}
          >
            <Ionicons name="logo-whatsapp" size={24} color="#25D366" />
          </TouchableOpacity>
        ) : <View style={{ width: 40 }} />}
      </View>
      <ScrollView style={styles.scroll} contentContainerStyle={styles.scrollContent}>

        <View style={styles.fichaInfo}>
          {paciente.email ? <Text style={styles.fichaDetalhe}> {paciente.email}</Text> : null}
          {paciente.whatsapp ? <Text style={styles.fichaDetalhe}> {paciente.whatsapp}</Text> : null}
          {paciente.cpf ? <Text style={styles.fichaDetalhe}> {paciente.cpf}</Text> : null}
        </View>

        {loading ? <ActivityIndicator color="#1D9E75" style={{ marginTop: 40 }} /> : historico.length === 0 ? (
          <Text style={styles.emptyText}>Nenhuma recomendação ainda</Text>
        ) : (
          <>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginBottom: 16 }} contentContainerStyle={{ gap: 8, paddingHorizontal: 2 }}>
              {meses.map(m => (
                <TouchableOpacity
                  key={m}
                  style={[styles.mesBadge, mesSelecionado === m && styles.mesBadgeAtivo]}
                  onPress={() => { setMesSelecionado(m); setDiaSelecionado(null); }}
                >
                  <Text style={[styles.mesBadgeText, mesSelecionado === m && styles.mesBadgeTextAtivo]}>
                    {formatMesAno(m)}
                  </Text>
                </TouchableOpacity>
              ))}
            </ScrollView>

            {mesSelecionado && (
              <View style={styles.calCard}>
                <Text style={styles.calTitulo}>{formatMesAno(mesSelecionado)}</Text>
                <View style={styles.calSemana}>
                  {['D','S','T','Q','Q','S','S'].map((d, i) => (
                    <Text key={i} style={styles.calDiaSemana}>{d}</Text>
                  ))}
                </View>
                <View style={styles.calGrid}>
                  {Array.from({ length: primeiroDia }).map((_, i) => (
                    <View key={'empty-' + i} style={styles.calCelula} />
                  ))}
                  {Array.from({ length: totalDias }).map((_, i) => {
                    const dia = i + 1;
                    const temConsulta = !!diasComConsulta[dia];
                    const temRetorno = !!diasRetorno[dia];
                    const temAlgo = temConsulta || temRetorno;
                    const selecionado = diaSelecionado === dia;
                    return (
                      <TouchableOpacity
                        key={dia}
                        style={[
                          styles.calCelula,
                          temConsulta && styles.calCelulaConsulta,
                          temRetorno && !temConsulta && styles.calCelulaRetorno,
                          selecionado && styles.calCelulaSelecionada,
                        ]}
                        onPress={() => temAlgo ? setDiaSelecionado(selecionado ? null : dia) : null}
                        activeOpacity={temAlgo ? 0.7 : 1}
                      >
                        <Text style={[
                          styles.calDiaNum,
                          temConsulta && styles.calDiaNumConsulta,
                          temRetorno && !temConsulta && styles.calDiaNumRetorno,
                          selecionado && styles.calDiaNumSelecionado,
                        ]}>{dia}</Text>
                        {temConsulta && !selecionado && <View style={styles.calDot} />}
                        {temRetorno && !temConsulta && !selecionado && <View style={[styles.calDot, { backgroundColor: '#f59e0b' }]} />}
                      </TouchableOpacity>
                    );
                  })}
                </View>
              </View>
            )}

            {diaSelecionado && recsDiaSelecionado.length > 0 && (
              <View style={{ marginTop: 12 }}>
                <Text style={styles.sectionTitle}>
                  {diaSelecionado}/{mesSelecionado?.slice(5, 7)}/{mesSelecionado?.slice(0, 4)}
                </Text>
                {recsDiaSelecionado.map((r, idx) => {
                  const produtos = getProdutosRec(r);
                  return (
                    <View key={r.id + '-' + idx} style={styles.historicoCard}>
                      <View style={[styles.tipoBadge, r._tipo === 'retorno' ? styles.tipoBadgeRetorno : styles.tipoBadgeConsulta]}>
                        <Text style={[styles.tipoBadgeText, r._tipo === 'retorno' ? styles.tipoBadgeTextRetorno : styles.tipoBadgeTextConsulta]}>
                          {r._tipo === 'retorno' ? 'Retorno' : 'Consulta'}
                        </Text>
                      </View>
                      {produtos.length > 0 ? (
                        produtos.map((nome, i) => (
                          <Text key={i} style={styles.historicoProduto}>• {nome}</Text>
                        ))
                      ) : (
                        <Text style={[styles.historicoProduto, { color: '#bbb' }]}>Sem produto registrado</Text>
                      )}
                      {r.notes && !r.notes.startsWith('{') ? <Text style={styles.historicoObs}>{r.notes}</Text> : null}
                    </View>
                  );
                })}
              </View>
            )}

            {!diaSelecionado && (
              <View style={{ marginTop: 4 }}>
                <Text style={styles.sectionTitle}>Todas as consultas</Text>
                {historico
                  .filter(r => !mesSelecionado || r.created_at.slice(0, 7) === mesSelecionado)
                  .map(r => {
                    const produtos = getProdutosRec(r);
                    return (
                      <View key={r.id} style={styles.historicoCard}>
                        <View style={styles.historicoHeader}>
                          <Text style={styles.historicoData}>{formatDate(r.created_at)}</Text>
                          {paciente.whatsapp && produtos.length > 0 && (
                            <TouchableOpacity onPress={() => {
                              const primeiroNome = paciente.name?.split(' ')[0] || 'paciente';
                              const listaProd = produtos.slice(0,2).join(' e ');
                              const msg = `Olá ${primeiroNome}! Tudo bem? Queria saber como você está se sentindo com ${listaProd}. Precisa de algo?`;
                              const num = paciente.whatsapp.replace(/[^0-9]/g, '');
                              const numBR = num.startsWith('55') ? num : '55' + num;
                              Linking.openURL('https://wa.me/' + numBR + '?text=' + encodeURIComponent(msg)).catch(() => {});
                            }}>
                              <Ionicons name="logo-whatsapp" size={18} color="#25D366" />
                            </TouchableOpacity>
                          )}
                        </View>
                        {r.return_date && (
                          <View style={[styles.retornoBadge, { alignSelf: 'flex-start', marginBottom: 6 }]}>
                            <Text style={styles.retornoBadgeText}>Retorno: {formatDate(r.return_date)}</Text>
                          </View>
                        )}
                        {produtos.length > 0 ? (
                          produtos.map((nome, i) => (
                            <Text key={i} style={styles.historicoProduto}>• {nome}</Text>
                          ))
                        ) : (
                          <Text style={[styles.historicoProduto, { color: '#bbb' }]}>Sem produto registrado</Text>
                        )}
                        {r.notes && !r.notes.startsWith('{') ? <Text style={styles.historicoObs}>{r.notes}</Text> : null}
                      </View>
                    );
                  })}
              </View>
            )}
          </>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

// ─── ABA INÍCIO ──────────────────────────────────────────────────────────────
function TabInicio({ doctor, onLogout, onTabChange }) {
  const [stats, setStats] = useState({ pacientes: 0, recomendacoes: 0 });
  const [retornos, setRetornos] = useState([]);
  const [recentes, setRecentes] = useState([]);
  const [lembretes10dias, setLembretes10dias] = useState([]);
  const [pontos, setPontos] = useState(0);
  const [filtroStatus, setFiltroStatus] = useState('not_started');
  const [filtroDias, setFiltroDias] = useState(10);
  const [mostrarFiltros, setMostrarFiltros] = useState(false);
  const [filtrosPendentes, setFiltrosPendentes] = useState({ status: 'not_started', dias: 10 });

  useEffect(() => {
    // filtros usam apenas estado local
  }, []);

  useEffect(() => {
    async function load() {
      const { count: pacientes } = await sb.from('patients')
        .select('*', { count: 'exact', head: true })
        .eq('doctor_id', doctor.id);
      const { count: recomendacoes } = await sb.from('recommendations')
        .select('*', { count: 'exact', head: true })
        .eq('doctor_id', doctor.id);

      const hojeLocal = new Date();
      hojeLocal.setHours(0, 0, 0, 0);
      const daqui2semanas = new Date(hojeLocal);
      daqui2semanas.setDate(daqui2semanas.getDate() + 14);
      const hoje = hojeLocal.toISOString().split('T')[0];
      const limite = daqui2semanas.toISOString().split('T')[0];

      const { data: retornosData } = await sb.from('recommendations')
        .select('id, created_at, return_date, patients(id, name, whatsapp), products(name), recommendation_items(products(name))')
        .eq('doctor_id', doctor.id)
        .not('return_date', 'is', null)
        .gte('return_date', hoje)
        .lte('return_date', limite)
        .order('return_date', { ascending: true });

      const { data: recentesData } = await sb.from('recommendations')
        .select('id, created_at, patients(name)')
        .eq('doctor_id', doctor.id)
        .order('created_at', { ascending: false })
        .limit(5);

      const haXdias = new Date(hojeLocal);
      haXdias.setDate(haXdias.getDate() - filtroDias);
      let lembretesQuery = sb.from('recommendations')
        .select('id, created_at, status, notes, patients(id, name, whatsapp, email), products(name), recommendation_items(products(name))')
        .eq('doctor_id', doctor.id)
        .gte('created_at', haXdias.toISOString())
        .order('created_at', { ascending: false });
      if (filtroStatus !== 'all') lembretesQuery = lembretesQuery.eq('status', filtroStatus);
      const { data: lembretesData } = await lembretesQuery;

      setPontos(recomendacoes || 0);
      setStats({ pacientes: pacientes || 0, recomendacoes: recomendacoes || 0 });
      setRetornos((retornosData || []).filter(r => {
        const dataRetorno = new Date(r.return_date + 'T00:00:00');
        return dataRetorno >= hojeLocal;
      }));
      setRecentes(recentesData || []);
      const docEmail = doctor?.email?.toLowerCase() || '';
      setLembretes10dias((lembretesData || []).filter(r => {
        const patEmail = r.patients?.email?.toLowerCase() || '';
        return !docEmail || patEmail !== docEmail;
      }));
    }
    load();
  }, [filtroStatus, filtroDias]);

  function formatDate(d) {
    if (!d) return '';
    return new Date(d).toLocaleDateString('pt-BR', { day: '2-digit', month: 'short' });
  }

  function diasAte(d) {
    const hoje = new Date(); hoje.setHours(0,0,0,0);
    const alvo = new Date(d); alvo.setHours(0,0,0,0);
    const diff = Math.round((alvo - hoje) / 86400000);
    if (diff === 0) return 'hoje';
    if (diff === 1) return 'amanhã';
    return `em ${diff} dias`;
  }

  function abrirWhatsApp(telefone, mensagem) {
    const num = (telefone || '').replace(/\D/g, '');
    if (!num) { Alert.alert('Sem telefone', 'Este paciente não tem WhatsApp cadastrado.'); return; }
    const numBR = num.startsWith('55') ? num : '55' + num;
    const url = `https://wa.me/${numBR}?text=${encodeURIComponent(mensagem)}`;
    Linking.openURL(url).catch(() => Alert.alert('Erro', 'Não foi possível abrir o WhatsApp.'));
  }

  return (
    <ScrollView style={styles.scroll} contentContainerStyle={styles.scrollContent} showsVerticalScrollIndicator={false}>
      <View style={styles.pageHeader}>
        <View>
          <Text style={styles.pageGreeting}>Olá, {doctor?.name?.split(' ')[0]}</Text>
          <Text style={styles.pageSubtitle}>{doctor?.specialty || 'synka'}</Text>
        </View>
      </View>

      {retornos.length > 0 && (
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Próximos retornos</Text>
          {retornos.map(r => {
            const produtos = [];
            if (r.recommendation_items?.length > 0) {
              r.recommendation_items.forEach(i => { if (i.products?.name) produtos.push(i.products.name); });
            } else if (r.products?.name) {
              produtos.push(r.products.name);
            }
            const prazo = diasAte(r.return_date);
            const nomeP = r.patients?.name?.split(' ')[0] || 'paciente';
            const msgRetorno = `Olá ${nomeP}! Passando para confirmar seu retorno no dia ${formatDate(r.return_date)}. Até logo! 😊`;
            return (
              <View key={r.id} style={styles.retornoCard}>
                <View style={styles.retornoInfo}>
                  <Text style={styles.retornoNome}>{r.patients?.name}</Text>
                  <Text style={styles.retornoData}>{formatDate(r.return_date)} · {prazo}</Text>
                  {produtos.map((p, i) => (
                    <Text key={i} style={styles.retornoProduto}>• {p}</Text>
                  ))}
                </View>
                <View style={styles.retornoAcoes}>
                  <View style={[styles.retornoBadge, prazo === 'hoje' && { backgroundColor: '#fff0e0' }]}>
                    <Text style={[styles.retornoBadgeText, prazo === 'hoje' && { color: '#f59e0b' }]}>{prazo}</Text>
                  </View>
                  <TouchableOpacity
                    style={styles.retornoWaBtn}
                    onPress={() => abrirWhatsApp(r.patients?.whatsapp, msgRetorno)}
                  >
                    <Text style={styles.retornoWaText}></Text>
                  </TouchableOpacity>
                </View>
              </View>
            );
          })}
        </View>
      )}

      <TouchableOpacity style={styles.ctaBtn} onPress={() => onTabChange('receitar')} activeOpacity={0.85}>
        <Text style={styles.ctaText}>+ Nova recomendação</Text>
      </TouchableOpacity>

      <View style={styles.section}>
          <View style={styles.sectionHeaderRow}>
            <Text style={styles.sectionTitle}>Acompanhamento</Text>
            <TouchableOpacity onPress={() => setMostrarFiltros(!mostrarFiltros)} style={styles.filtroBtn}>
              <Ionicons name="options-outline" size={16} color="#1D9E75" />
              <Text style={styles.filtroBtnText}>Filtrar</Text>
            </TouchableOpacity>
          </View>

          {mostrarFiltros && (
            <View style={styles.filtrosBox}>
              <Text style={styles.filtroLabel}>Status</Text>
              <View style={styles.filtroOpcoes}>
                {[['all','Todos'],['not_started','Pendentes'],['active','Em uso'],['completed','Concluídos']].map(([val, label]) => (
                  <TouchableOpacity key={val} style={[styles.filtroOpcao, filtrosPendentes.status === val && styles.filtroOpcaoAtiva]} onPress={() => setFiltrosPendentes(p => ({ ...p, status: val }))}>
                    <Text style={[styles.filtroOpcaoText, filtrosPendentes.status === val && styles.filtroOpcaoTextAtiva]}>{label}</Text>
                  </TouchableOpacity>
                ))}
              </View>
              <Text style={[styles.filtroLabel, { marginTop: 10 }]}>Período</Text>
              <View style={styles.filtroOpcoes}>
                {[[7,'7 dias'],[10,'10 dias'],[15,'15 dias'],[30,'30 dias']].map(([val, label]) => (
                  <TouchableOpacity key={val} style={[styles.filtroOpcao, filtrosPendentes.dias === val && styles.filtroOpcaoAtiva]} onPress={() => setFiltrosPendentes(p => ({ ...p, dias: val }))}>
                    <Text style={[styles.filtroOpcaoText, filtrosPendentes.dias === val && styles.filtroOpcaoTextAtiva]}>{label}</Text>
                  </TouchableOpacity>
                ))}
              </View>
              <TouchableOpacity style={styles.filtroSalvarBtn} onPress={async () => {
                setFiltroStatus(filtrosPendentes.status);
                setFiltroDias(filtrosPendentes.dias);
                setMostrarFiltros(false);
              }}>
                <Text style={styles.filtroSalvarText}>Aplicar e salvar</Text>
              </TouchableOpacity>
            </View>
          )}

          {lembretes10dias
            .filter(r => {
              const diasAtras = new Date();
              diasAtras.setDate(diasAtras.getDate() - filtroDias);
              const criado = new Date(r.created_at);
              if (criado < diasAtras) return false;
              if (filtroStatus !== 'all' && r.status !== filtroStatus) return false;
              return true;
            })
            .map(r => {
              const nomeP = r.patients?.name?.split(' ')[0] || 'paciente';
              let produto = r.products?.name || '';
              if (!produto && r.recommendation_items?.length > 0)
                produto = r.recommendation_items[0]?.products?.name || '';
              if (!produto) { try { const m = JSON.parse(r.notes || ''); if (m?.__manipulado) produto = m.nome || ''; } catch(_) {} }
              if (!produto) produto = 'o produto';
              const msgAcomp = `Olá ${nomeP}! Tudo bem? Como está se sentindo com ${produto}?`;
              return (
                <View key={r.id} style={styles.retornoCard}>
                  <View style={styles.retornoInfo}>
                    <Text style={styles.retornoNome}>{r.patients?.name}</Text>
                    <Text style={styles.retornoData}>{produto} · {formatDate(r.created_at)}</Text>
                  </View>
                  <TouchableOpacity style={styles.waIconBtn} onPress={() => {
                    abrirWhatsApp(r.patients?.whatsapp, msgAcomp);
                    setLembretes10dias(prev => prev.filter(l => l.id !== r.id));
                  }}>
                    <Ionicons name="logo-whatsapp" size={22} color="#25D366" />
                  </TouchableOpacity>
                </View>
              );
            })
          }
          {lembretes10dias.length === 0 && (
            <Text style={{ fontSize: 13, color: '#bbb', textAlign: 'center', paddingVertical: 12 }}>Nenhum paciente neste período</Text>
          )}
        </View>

      {recentes.length > 0 && (
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Recentes</Text>
          {recentes.map(r => (
            <View key={r.id} style={styles.recenteCard}>
              <Text style={styles.recenteNome}>{r.patients?.name}</Text>
              <Text style={styles.recenteData}>{formatDate(r.created_at)}</Text>
            </View>
          ))}
        </View>
      )}
    </ScrollView>
  );
}

// ─── ABA RECEITAR ─────────────────────────────────────────────────────────────
function TabReceitar({ doctor, onTabChange }) {
  const [pacienteBusca, setPacienteBusca] = useState('');
  const [pacientes, setPacientes] = useState([]);
  const [pacienteSelecionado, setPacienteSelecionado] = useState(null);
  const [produtos, setProdutos] = useState([]);
  const [produtosBusca, setProdutosBusca] = useState('');
  const [produtosFiltrados, setProdutosFiltrados] = useState([]);
  const [carrinho, setCarrinho] = useState([]);
  const [manipulados, setManipulados] = useState([]);
  const [observacoes, setObservacoes] = useState('');
  const [returnDate, setReturnDate] = useState('');
  const [enviando, setEnviando] = useState(false);
  const [sucesso, setSucesso] = useState(false);
  const [novoNome, setNovoNome] = useState('');
  const [novoEmail, setNovoEmail] = useState('');
  const [novoWA, setNovoWA] = useState('');
  const [modoNovo, setModoNovo] = useState(false);
  const [step, setStep] = useState(1);
  const [top5, setTop5] = useState([]);
  const [alertaControlado, setAlertaControlado] = useState(null);
  const [alertaDuplicado, setAlertaDuplicado] = useState(null);

  useEffect(() => {
    sb.from('products').select('*').order('name')
      .then(({ data }) => { setProdutos(data || []); setProdutosFiltrados(data || []); });
    sb.from('recommendations')
      .select('product_id, products:product_id(id, name, category)')
      .eq('doctor_id', doctor.id)
      .not('product_id', 'is', null)
      .then(({ data }) => {
        if (!data) return;
        const contagem = {};
        data.forEach(r => {
          const id = r.product_id;
          if (!id || !r.products?.name) return;
          if (!contagem[id]) contagem[id] = { ...r.products, total: 0 };
          contagem[id].total += 1;
        });
        setTop5(Object.values(contagem).sort((a, b) => b.total - a.total).slice(0, 5));
      });
  }, []);

  useEffect(() => {
    if (!pacienteBusca.trim()) { setPacientes([]); return; }
    sb.from('patients').select('*')
      .eq('doctor_id', doctor.id)
      .ilike('name', `%${pacienteBusca}%`)
      .limit(5)
      .then(({ data }) => setPacientes(data || []));
  }, [pacienteBusca]);

  useEffect(() => {
    if (!produtosBusca.trim()) { setProdutosFiltrados(produtos); return; }
    setProdutosFiltrados(produtos.filter(p =>
      p.name?.toLowerCase().includes(produtosBusca.toLowerCase()) ||
      p.category?.toLowerCase().includes(produtosBusca.toLowerCase())
    ));
  }, [produtosBusca, produtos]);

  const [recsAtivoPaciente, setRecsAtivoPaciente] = useState([]);

  useEffect(() => {
    if (!pacienteSelecionado?.id) { setRecsAtivoPaciente([]); return; }
    sb.from('recommendations')
      .select('id, status, products:product_id(id, name)')
      .eq('patient_id', pacienteSelecionado.id)
      .in('status', ['active', 'not_started'])
      .then(({ data }) => setRecsAtivoPaciente(data || []));
  }, [pacienteSelecionado?.id]);

  function toggleCarrinho(produto) {
    const jaEsta = carrinho.find(p => p.id === produto.id);
    if (jaEsta) {
      setCarrinho(prev => prev.filter(p => p.id !== produto.id));
      return;
    }
    const jaTem = recsAtivoPaciente.find(r => r.products?.id === produto.id || r.products?.name?.toLowerCase() === produto.name?.toLowerCase());
    if (jaTem) {
      setAlertaDuplicado(produto);
      return;
    }
    if (isProdutoControlado(produto.name)) {
      setAlertaControlado(produto);
      return;
    }
    setCarrinho(prev => [...prev, { ...produto, dosage: '', frequency: '', duration: '', instrucoes: '' }]);
  }

  function adicionarMesmoControlado() {
    if (!alertaControlado) return;
    setCarrinho(prev => [...prev, { ...alertaControlado, dosage: '', frequency: '', duration: '', instrucoes: '' }]);
    setAlertaControlado(null);
  }

  function adicionarMesmoDuplicado() {
    if (!alertaDuplicado) return;
    if (isProdutoControlado(alertaDuplicado.name)) {
      setAlertaControlado(alertaDuplicado);
    } else {
      setCarrinho(prev => [...prev, { ...alertaDuplicado, dosage: '', frequency: '', duration: '', instrucoes: '' }]);
    }
    setAlertaDuplicado(null);
  }

  function updateCampo(id, campo, valor) {
    setCarrinho(prev => prev.map(p => p.id === id ? { ...p, [campo]: valor } : p));
  }

  function addManipulado() {
    setManipulados(prev => [...prev, {
      id: Date.now().toString(),
      nome: '',
      componentes: [{ nome: '', conc: '' }],
      veiculo: '',
      qtd: '',
      dosage: '',
      frequency: '',
      duration: '',
      notas: '',
      farmaciaId: null,
      farmaciaNome: '',
      farmaciaWa: '',
    }]);
  }

  function updateManipulado(id, campo, valor) {
    setManipulados(prev => prev.map(m => m.id === id ? { ...m, [campo]: valor } : m));
  }

  function updateComponente(manipId, idx, campo, valor) {
    setManipulados(prev => prev.map(m => {
      if (m.id !== manipId) return m;
      const comps = [...m.componentes];
      comps[idx] = { ...comps[idx], [campo]: valor };
      return { ...m, componentes: comps };
    }));
  }

  function addComponente(manipId) {
    setManipulados(prev => prev.map(m =>
      m.id === manipId ? { ...m, componentes: [...m.componentes, { nome: '', conc: '' }] } : m
    ));
  }

  function removeComponente(manipId, idx) {
    setManipulados(prev => prev.map(m => {
      if (m.id !== manipId) return m;
      const comps = m.componentes.filter((_, i) => i !== idx);
      return { ...m, componentes: comps.length ? comps : [{ nome: '', conc: '' }] };
    }));
  }

  function removeManipulado(id) {
    setManipulados(prev => prev.filter(m => m.id !== id));
  }

  async function criarNovoPaciente() {
    if (!novoNome || !novoEmail) { Alert.alert('Preencha nome e email'); return; }
    const { data, error } = await sb.from('patients').insert([{
      name: novoNome, email: novoEmail,
      whatsapp: novoWA.replace(/\D/g, '') || null,
      doctor_id: doctor.id,
    }]).select().single();
    if (error) { Alert.alert('Erro ao criar paciente'); return; }
    setPacienteSelecionado(data);
    setModoNovo(false);
    setNovoNome(''); setNovoEmail(''); setNovoWA('');
  }

  // ─── ENVIAR RECOMENDAÇÃO — dispara cotações automaticamente para manipulados ───
  async function enviarRecomendacao() {
    if (!pacienteSelecionado) { Alert.alert('Selecione um paciente'); return; }
    if (carrinho.length === 0 && manipulados.length === 0) {
      Alert.alert('Adicione pelo menos um produto ou fórmula'); return;
    }

    let rdISO = null;
    if (returnDate && returnDate.length === 10) {
      const [d, m, y] = returnDate.split('/');
      rdISO = `${y}-${m}-${d}`;
    }

    setEnviando(true);

    const inserts = [];

    for (const p of carrinho) {
      inserts.push({
        doctor_id: doctor.id,
        patient_id: pacienteSelecionado.id,
        product_id: p.id,
        dosage: p.dosage || null,
        frequency: p.frequency || null,
        duration: p.duration || null,
        notes: observacoes || null,
        return_date: rdISO,
        status: 'not_started',
      });
    }

    for (const m of manipulados) {
      const manipJSON = JSON.stringify({
        __manipulado: true,
        nome: m.nome || 'Fórmula manipulada',
        componentes: m.componentes.filter(c => c.nome.trim()),
        veiculo: m.veiculo || '',
        qtd: m.qtd || '',
        dosage: m.dosage || '',
        frequency: m.frequency || '',
        duration: m.duration || '',
        notes: m.notas || '',
        farmacia: m.farmaciaNome || '',
        farmaciaWa: m.farmaciaWa || '',
      });
      inserts.push({
        doctor_id: doctor.id,
        patient_id: pacienteSelecionado.id,
        product_id: null,
        notes: manipJSON,
        dosage: m.dosage || null,
        frequency: m.frequency || null,
        duration: m.duration || null,
        return_date: rdISO,
        status: 'not_started',
      });
    }

    const { data: savedRecs, error } = await sb.from('recommendations').insert(inserts).select();
    if (error) { Alert.alert('Erro ao enviar: ' + error.message); setEnviando(false); return; }

    // Dispara solicitar-cotacao automaticamente para cada manipulado
    if (savedRecs && manipulados.length > 0) {
      try {
        const { data: { session } } = await sb.auth.getSession();
        const token = session?.access_token || SUPABASE_KEY;
        const manipSalvos = savedRecs.filter(r => r.product_id === null);
        for (const rec of manipSalvos) {
          try {
            await fetch(`${SUPABASE_URL}/functions/v1/solicitar-cotacao`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + token },
              body: JSON.stringify({ recommendation_id: rec.id }),
            });
          } catch(e) {
            console.log('Erro ao solicitar cotação para rec', rec.id, e);
          }
        }
      } catch(e) {
        console.log('Erro ao obter sessão para cotações:', e);
      }
    }

    setEnviando(false);
    setSucesso(true);
    setTimeout(() => {
      setSucesso(false);
      setPacienteSelecionado(null); setPacienteBusca('');
      setCarrinho([]); setManipulados([]);
      setObservacoes(''); setReturnDate('');
      setStep(1);
      onTabChange('inicio');
    }, 2000);
  }
  // ─────────────────────────────────────────────────────────────────────────────

  if (sucesso) {
    return (
      <View style={styles.successContainer}>
        <Text style={styles.successIcon}>✓</Text>
        <Text style={styles.successTitle}>Recomendação enviada!</Text>
        <Text style={styles.successSub}>O paciente já pode visualizar</Text>
      </View>
    );
  }

  function StepHeader() {
    const steps = ['Paciente', 'Produtos', 'Confirmar'];
    return (
      <View style={styles.stepHeader}>
        {steps.map((s, i) => {
          const num = i + 1;
          const ativo = step === num;
          const feito = step > num;
          return (
            <View key={s} style={styles.stepItem}>
              <View style={[styles.stepCircle, ativo && styles.stepCircleAtivo, feito && styles.stepCircleFeito]}>
                {feito
                  ? <Ionicons name="checkmark" size={14} color="white" />
                  : <Text style={[styles.stepNum, (ativo || feito) && { color: 'white' }]}>{num}</Text>
                }
              </View>
              <Text style={[styles.stepLabel, ativo && styles.stepLabelAtivo]}>{s}</Text>
            </View>
          );
        })}
      </View>
    );
  }

  return (
    <ScrollView style={styles.scroll} contentContainerStyle={styles.scrollContent} keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>

      <StepHeader />

      {/* MODAL ALERTA CONTROLADO */}
      <Modal visible={!!alertaControlado} transparent animationType="fade" onRequestClose={() => setAlertaControlado(null)}>
        <View style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'center', alignItems: 'center', padding: 24 }}>
          <View style={{ backgroundColor: 'white', borderRadius: 20, padding: 24, width: '100%', maxWidth: 360 }}>
            <View style={{ width: 56, height: 56, borderRadius: 28, backgroundColor: '#fff0e0', alignItems: 'center', justifyContent: 'center', alignSelf: 'center', marginBottom: 16 }}>
              <Ionicons name="warning" size={28} color="#f59e0b" />
            </View>
            <Text style={{ fontSize: 17, fontWeight: '700', color: '#0f1f1a', textAlign: 'center', marginBottom: 8 }}>Medicamento controlado</Text>
            <Text style={{ fontSize: 14, color: '#666', textAlign: 'center', lineHeight: 20, marginBottom: 8 }}>
              <Text style={{ fontWeight: '700', color: '#0f1f1a' }}>{alertaControlado?.name}</Text> pode ser um medicamento de tarja vermelha ou preta.
            </Text>
            <Text style={{ fontSize: 13, color: '#888', textAlign: 'center', lineHeight: 18, marginBottom: 20 }}>
              Para receitar controlados, utilize um receituário oficial (papel, Memed, Mevo ou similar). A prescrição pelo Synka não substitui o documento legal obrigatório.
            </Text>
            <Text style={{ fontSize: 12, fontWeight: '700', color: '#888', textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 10, textAlign: 'center' }}>Emitir receita oficial</Text>
            <TouchableOpacity
              style={{ backgroundColor: '#1a73e8', borderRadius: 12, padding: 14, alignItems: 'center', flexDirection: 'row', justifyContent: 'center', gap: 8, marginBottom: 8 }}
              onPress={() => { setAlertaControlado(null); Linking.openURL('https://memed.com.br').catch(() => {}); }}
            >
              <Ionicons name="document-text-outline" size={18} color="white" />
              <Text style={{ color: 'white', fontWeight: '700', fontSize: 15 }}>Emitir pelo Memed</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={{ backgroundColor: '#6c3fc5', borderRadius: 12, padding: 14, alignItems: 'center', flexDirection: 'row', justifyContent: 'center', gap: 8, marginBottom: 8 }}
              onPress={() => { setAlertaControlado(null); Linking.openURL('https://mevo.com.br').catch(() => {}); }}
            >
              <Ionicons name="document-text-outline" size={18} color="white" />
              <Text style={{ color: 'white', fontWeight: '700', fontSize: 15 }}>Emitir pelo Mevo</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={{ backgroundColor: '#e8f5f0', borderRadius: 12, padding: 14, alignItems: 'center', flexDirection: 'row', justifyContent: 'center', gap: 8, marginBottom: 12 }}
              onPress={() => { adicionarMesmoControlado(); }}
            >
              <Ionicons name="pencil-outline" size={18} color="#1D9E75" />
              <Text style={{ color: '#1D9E75', fontWeight: '700', fontSize: 15 }}>Vou prescrever no papel</Text>
            </TouchableOpacity>
            <View style={{ borderTopWidth: 1, borderTopColor: '#f0f0f0', paddingTop: 12 }}>
              <TouchableOpacity
                style={{ backgroundColor: '#f5f5f5', borderRadius: 12, padding: 14, alignItems: 'center' }}
                onPress={() => setAlertaControlado(null)}
              >
                <Text style={{ color: '#666', fontWeight: '600', fontSize: 15 }}>Cancelar</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>

      {/* MODAL REMÉDIO DUPLICADO */}
      <Modal visible={!!alertaDuplicado} transparent animationType="fade" onRequestClose={() => setAlertaDuplicado(null)}>
        <View style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'center', alignItems: 'center', padding: 24 }}>
          <View style={{ backgroundColor: 'white', borderRadius: 20, padding: 24, width: '100%', maxWidth: 360 }}>
            <View style={{ width: 56, height: 56, borderRadius: 28, backgroundColor: '#e8f5f0', alignItems: 'center', justifyContent: 'center', alignSelf: 'center', marginBottom: 16 }}>
              <Ionicons name="copy-outline" size={28} color="#1D9E75" />
            </View>
            <Text style={{ fontSize: 17, fontWeight: '700', color: '#0f1f1a', textAlign: 'center', marginBottom: 8 }}>Remédio já prescrito</Text>
            <Text style={{ fontSize: 14, color: '#666', textAlign: 'center', lineHeight: 20, marginBottom: 20 }}>
              <Text style={{ fontWeight: '700', color: '#0f1f1a' }}>{alertaDuplicado?.name}</Text> já está ativo para este paciente. Tem certeza que quer prescrever novamente?
            </Text>
            <TouchableOpacity
              style={{ backgroundColor: '#1D9E75', borderRadius: 12, padding: 14, alignItems: 'center', marginBottom: 10 }}
              onPress={adicionarMesmoDuplicado}
            >
              <Text style={{ color: 'white', fontWeight: '700', fontSize: 15 }}>Sim, prescrever novamente</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={{ backgroundColor: '#f5f5f5', borderRadius: 12, padding: 14, alignItems: 'center' }}
              onPress={() => setAlertaDuplicado(null)}
            >
              <Text style={{ color: '#666', fontWeight: '600', fontSize: 15 }}>Cancelar</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>

      {/* STEP 1: PACIENTE */}
      {step === 1 && (
        <View>
          <View style={styles.card}>
            <Text style={styles.cardTitle}>Selecionar paciente</Text>
            {pacienteSelecionado ? (
              <View style={styles.pacienteSelecionado}>
                <View style={styles.pacienteInfo}>
                  <Text style={styles.pacienteNome}>{pacienteSelecionado.name}</Text>
                  <Text style={styles.pacienteEmail}>{pacienteSelecionado.email}</Text>
                </View>
                <TouchableOpacity onPress={() => setPacienteSelecionado(null)}>
                  <Text style={styles.trocarText}>Trocar</Text>
                </TouchableOpacity>
              </View>
            ) : modoNovo ? (
              <View>
                <TextInput style={styles.input} placeholder="Nome completo" placeholderTextColor="#999" value={novoNome} onChangeText={setNovoNome} autoCapitalize="words" />
                <TextInput style={[styles.input, { marginTop: 8 }]} placeholder="Email" placeholderTextColor="#999" value={novoEmail} onChangeText={setNovoEmail} keyboardType="email-address" autoCapitalize="none" />
                <TextInput style={[styles.input, { marginTop: 8 }]} placeholder="WhatsApp (opcional)" placeholderTextColor="#999" value={novoWA} onChangeText={setNovoWA} keyboardType="phone-pad" />
                <View style={styles.novoRow}>
                  <TouchableOpacity style={styles.btnSecundario} onPress={() => setModoNovo(false)}>
                    <Text style={styles.btnSecundarioText}>Cancelar</Text>
                  </TouchableOpacity>
                  <TouchableOpacity style={styles.btnPrimario} onPress={criarNovoPaciente}>
                    <Text style={styles.btnPrimarioText}>Salvar</Text>
                  </TouchableOpacity>
                </View>
              </View>
            ) : (
              <View>
                <TextInput style={styles.input} placeholder="Buscar paciente..." placeholderTextColor="#999" value={pacienteBusca} onChangeText={setPacienteBusca} />
                {pacientes.map(p => (
                  <TouchableOpacity key={p.id} style={styles.sugestaoItem} onPress={() => { setPacienteSelecionado(p); setPacienteBusca(''); setPacientes([]); }}>
                    <Text style={styles.sugestaoNome}>{p.name}</Text>
                    <Text style={styles.sugestaoEmail}>{p.email}</Text>
                  </TouchableOpacity>
                ))}
                <TouchableOpacity style={styles.novoPacienteBtn} onPress={() => setModoNovo(true)}>
                  <Text style={styles.novoPacienteText}>+ Novo paciente</Text>
                </TouchableOpacity>
              </View>
            )}
          </View>

          {pacienteSelecionado && (
            <TouchableOpacity style={styles.btnEnviar} onPress={() => setStep(2)}>
              <Text style={styles.btnEnviarText}>Próximo</Text>
              <Ionicons name="arrow-forward" size={18} color="white" />
            </TouchableOpacity>
          )}
        </View>
      )}

      {/* STEP 2: PRODUTOS */}
      {step === 2 && (
        <View>
          {carrinho.length > 0 && (
            <View style={styles.card}>
              <View style={styles.cardTitleRow}>
                <Text style={styles.cardTitle}>Selecionados ({carrinho.length})</Text>
              </View>
              {carrinho.map(p => (
                <View key={p.id} style={[styles.produtoItem, styles.produtoItemAtivo]}>
                  <View style={styles.produtoInfo}>
                    <Text style={styles.produtoNomeAtivo}>{p.name}</Text>
                    <Text style={styles.produtoCategoria}>{p.category}</Text>
                  </View>
                  <TouchableOpacity onPress={() => toggleCarrinho(p)}>
                    <Ionicons name="close-circle" size={20} color="#e05555" />
                  </TouchableOpacity>
                </View>
              ))}
            </View>
          )}

          {top5.length > 0 && !produtosBusca && (
            <View style={styles.card}>
              <Text style={styles.cardTitle}>Mais receitados</Text>
              {top5.map((p, i) => {
                const noCarrinho = carrinho.find(c => c.id === p.id);
                return (
                  <TouchableOpacity key={p.id} style={[styles.produtoItem, noCarrinho && styles.produtoItemAtivo]} onPress={() => toggleCarrinho(p)} activeOpacity={0.7}>
                    <View style={styles.top5NumSmall}><Text style={styles.top5NumSmallText}>{i + 1}</Text></View>
                    <View style={styles.produtoInfo}>
                      <Text style={[styles.produtoNome, noCarrinho && styles.produtoNomeAtivo]}>{p.name}</Text>
                      <Text style={styles.produtoCategoria}>{p.category}</Text>
                    </View>
                    {noCarrinho && <Ionicons name="checkmark-circle" size={20} color="#1D9E75" />}
                  </TouchableOpacity>
                );
              })}
            </View>
          )}

          <View style={styles.card}>
            <Text style={styles.cardTitle}>Produtos {carrinho.length > 0 ? `(${carrinho.length})` : ''}</Text>
            <TextInput style={styles.input} placeholder="Buscar produto..." placeholderTextColor="#999" value={produtosBusca} onChangeText={setProdutosBusca} />
            <View style={{ marginTop: 8 }}>
              {produtosFiltrados.slice(0, 20).map(p => {
                const noCarrinho = carrinho.find(c => c.id === p.id);
                return (
                  <TouchableOpacity key={p.id} style={[styles.produtoItem, noCarrinho && styles.produtoItemAtivo]} onPress={() => toggleCarrinho(p)} activeOpacity={0.7}>
                    <View style={styles.produtoInfo}>
                      <Text style={[styles.produtoNome, noCarrinho && styles.produtoNomeAtivo]}>{p.name}</Text>
                      <Text style={styles.produtoCategoria}>{p.category}</Text>
                    </View>
                    {noCarrinho
                      ? <Ionicons name="checkmark-circle" size={20} color="#1D9E75" />
                      : <Ionicons name="add-circle-outline" size={20} color="#ccc" />
                    }
                  </TouchableOpacity>
                );
              })}
              {produtosBusca.length > 0 && produtosFiltrados.length === 0 && (
                <TouchableOpacity
                  style={{ flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 12, borderTopWidth: 1, borderTopColor: '#f5f5f5', marginTop: 4 }}
                  onPress={async () => {
                    const { data } = await sb.from('products').insert([{ name: produtosBusca, category: 'Outros', doctor_id: doctor.id }]).select().single();
                    if (data) { toggleCarrinho(data); setProdutosBusca(''); }
                    else Alert.alert('Produto adicionado! Aguarda aprovação da equipe synka');
                  }}
                >
                  <Ionicons name="add-circle" size={20} color="#1D9E75" />
                  <Text style={{ fontSize: 14, color: '#1D9E75', fontWeight: '600' }}>Adicionar "{produtosBusca}" ao catálogo</Text>
                </TouchableOpacity>
              )}
            </View>
          </View>

          <View style={styles.card}>
            <View style={styles.cardTitleRow}>
              <Text style={styles.cardTitle}>Manipulados</Text>
              <TouchableOpacity onPress={addManipulado} style={styles.addBtn}>
                <Text style={styles.addBtnText}>+ Adicionar</Text>
              </TouchableOpacity>
            </View>
            {manipulados.length === 0 ? (
              <Text style={styles.emptySmall}>Nenhuma fórmula adicionada</Text>
            ) : manipulados.map(m => (
              <View key={m.id} style={styles.manipuladoCard}>
                <TextInput style={styles.input} placeholder="Nome da fórmula" placeholderTextColor="#999" value={m.nome} onChangeText={v => updateManipulado(m.id, 'nome', v)} />
                <Text style={[styles.label, { marginTop: 10 }]}>Componentes</Text>
                {m.componentes.map((c, idx) => (
                  <View key={idx} style={styles.componenteRow}>
                    <TextInput style={[styles.input, { flex: 1 }]} placeholder="Ex: Minoxidil" placeholderTextColor="#999" value={c.nome} onChangeText={v => updateComponente(m.id, idx, 'nome', v)} />
                    <TextInput style={[styles.input, { width: 80, marginLeft: 6 }]} placeholder="5%" placeholderTextColor="#999" value={c.conc} onChangeText={v => updateComponente(m.id, idx, 'conc', v)} />
                    {m.componentes.length > 1 && (
                      <TouchableOpacity onPress={() => removeComponente(m.id, idx)} style={{ marginLeft: 6, padding: 8 }}>
                        <Ionicons name="close-circle" size={20} color="#e05555" />
                      </TouchableOpacity>
                    )}
                  </View>
                ))}
                <TouchableOpacity onPress={() => addComponente(m.id)} style={styles.addComponenteBtn}>
                  <Text style={styles.addComponenteBtnText}>+ Componente</Text>
                </TouchableOpacity>
                <View style={styles.manipRow}>
                  <TextInput style={[styles.input, { flex: 1 }]} placeholder="Veículo" placeholderTextColor="#999" value={m.veiculo} onChangeText={v => updateManipulado(m.id, 'veiculo', v)} />
                  <TextInput style={[styles.input, { width: 90, marginLeft: 6 }]} placeholder="Qtd" placeholderTextColor="#999" value={m.qtd} onChangeText={v => updateManipulado(m.id, 'qtd', v)} />
                </View>
                <View style={styles.manipRow}>
                  <TextInput style={[styles.input, { flex: 1 }]} placeholder="Posologia" placeholderTextColor="#999" value={m.dosage} onChangeText={v => updateManipulado(m.id, 'dosage', v)} />
                  <TextInput style={[styles.input, { flex: 1, marginLeft: 6 }]} placeholder="Frequência" placeholderTextColor="#999" value={m.frequency} onChangeText={v => updateManipulado(m.id, 'frequency', v)} />
                </View>
                <TextInput style={[styles.input, { marginTop: 6 }]} placeholder="Duração" placeholderTextColor="#999" value={m.duration} onChangeText={v => updateManipulado(m.id, 'duration', v)} />
                <TouchableOpacity onPress={() => removeManipulado(m.id)} style={[styles.removeBtn, { marginTop: 10 }]}>
                  <Text style={styles.removeBtnText}>Remover</Text>
                </TouchableOpacity>
              </View>
            ))}
          </View>

          <View style={styles.stepNavRow}>
            <TouchableOpacity style={styles.btnVoltar} onPress={() => setStep(1)}>
              <Ionicons name="arrow-back" size={18} color="#666" />
              <Text style={styles.btnVoltarText}>Voltar</Text>
            </TouchableOpacity>
            <TouchableOpacity style={[styles.btnEnviar, { flex: 1, flexDirection: 'row', gap: 6 }]} onPress={() => setStep(3)} disabled={carrinho.length === 0 && manipulados.length === 0}>
              <Text style={styles.btnEnviarText}>Próximo</Text>
              <Ionicons name="arrow-forward" size={18} color="white" />
            </TouchableOpacity>
          </View>
        </View>
      )}

      {/* STEP 3: CONFIRMAR */}
      {step === 3 && (
        <View>
          <View style={styles.card}>
            <Text style={styles.cardTitle}>Resumo</Text>
            <View style={styles.resumoRow}>
              <Text style={styles.resumoLabel}>Paciente</Text>
              <Text style={styles.resumoValor}>{pacienteSelecionado?.name}</Text>
            </View>
            <View style={styles.resumoRow}>
              <Text style={styles.resumoLabel}>Produtos</Text>
              <Text style={styles.resumoValor}>{carrinho.length + manipulados.length} item(s)</Text>
            </View>
            {carrinho.map(p => (
              <Text key={p.id} style={styles.resumoItem}>• {p.name}{p.dosage ? ' — ' + p.dosage : ''}</Text>
            ))}
            {manipulados.map(m => (
              <Text key={m.id} style={styles.resumoItem}>• {m.nome || 'Manipulado'} (fórmula)</Text>
            ))}
            {manipulados.length > 0 && (
              <View style={{ marginTop: 10, backgroundColor: '#e8f5f0', borderRadius: 10, padding: 10, flexDirection: 'row', gap: 8 }}>
                <Ionicons name="storefront-outline" size={16} color="#1D9E75" style={{ marginTop: 1 }} />
                <Text style={{ fontSize: 12, color: '#1D9E75', flex: 1, lineHeight: 17 }}>
                  Os orçamentos serão solicitados automaticamente às farmácias parceiras ao enviar.
                </Text>
              </View>
            )}
          </View>

          {carrinho.length > 0 && (
            <View style={styles.card}>
              <Text style={styles.cardTitle}>Posologia</Text>
              {carrinho.map(p => (
                <View key={p.id} style={{ marginBottom: 14 }}>
                  <Text style={styles.instrucaoLabel}>{p.name}</Text>
                  <View style={styles.manipRow}>
                    <TextInput style={[styles.input, { flex: 1 }]} placeholder="Dosagem" placeholderTextColor="#999" value={p.dosage} onChangeText={t => updateCampo(p.id, 'dosage', t)} />
                    <TextInput style={[styles.input, { flex: 1, marginLeft: 6 }]} placeholder="Frequência" placeholderTextColor="#999" value={p.frequency} onChangeText={t => updateCampo(p.id, 'frequency', t)} />
                  </View>
                  <TextInput style={[styles.input, { marginTop: 6 }]} placeholder="Duração (ex: 3 meses)" placeholderTextColor="#999" value={p.duration} onChangeText={t => updateCampo(p.id, 'duration', t)} />
                </View>
              ))}
            </View>
          )}

          <View style={styles.card}>
            <Text style={styles.cardTitle}>Próximo retorno</Text>
            <TextInput
              style={styles.input} placeholder="DD/MM/AAAA" placeholderTextColor="#999"
              value={returnDate}
              onChangeText={v => {
                const nums = v.replace(/\D/g,'').slice(0,8);
                let fmt = nums;
                if (nums.length > 4) fmt = nums.slice(0,2) + '/' + nums.slice(2,4) + '/' + nums.slice(4);
                else if (nums.length > 2) fmt = nums.slice(0,2) + '/' + nums.slice(2);
                setReturnDate(fmt);
              }}
              keyboardType="number-pad" maxLength={10}
            />
            <Text style={[styles.cardTitle, { marginTop: 16 }]}>Observações</Text>
            <TextInput style={[styles.input, { height: 70 }]} placeholder="Orientações adicionais..." placeholderTextColor="#999" value={observacoes} onChangeText={setObservacoes} multiline textAlignVertical="top" />
          </View>

          <View style={styles.stepNavRow}>
            <TouchableOpacity style={styles.btnVoltar} onPress={() => setStep(2)}>
              <Ionicons name="arrow-back" size={18} color="#666" />
              <Text style={styles.btnVoltarText}>Voltar</Text>
            </TouchableOpacity>
            <TouchableOpacity style={[styles.btnEnviar, { flex: 1, flexDirection: 'row', gap: 6 }]} onPress={enviarRecomendacao} disabled={enviando}>
              {enviando ? <ActivityIndicator color="white" size="small" /> : <>
                <Text style={styles.btnEnviarText}>Enviar</Text>
                <Ionicons name="send" size={16} color="white" />
              </>}
            </TouchableOpacity>
          </View>
        </View>
      )}

    </ScrollView>
  );
}

// ─── ABA PACIENTES ────────────────────────────────────────────────────────────
function TabPacientes({ doctor, onSelectPaciente }) {
  const [pacientes, setPacientes] = useState([]);
  const [busca, setBusca] = useState('');
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    sb.from('patients').select('*').eq('doctor_id', doctor.id).order('name')
      .then(({ data }) => { setPacientes(data || []); setLoading(false); });
  }, []);

  const norm = str => (str || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
  const filtrados = busca.trim() ? pacientes.filter(p => norm(p.name).includes(norm(busca)) || norm(p.email || '').includes(norm(busca))) : pacientes;

  return (
    <View style={styles.flex}>
      <View style={styles.pageHeaderSimples}>
        <Text style={styles.pageTitle}>Pacientes</Text>
      </View>
      <View style={styles.searchBar}>
        <TextInput style={styles.searchInput} placeholder="Buscar paciente..." placeholderTextColor="#999" value={busca} onChangeText={setBusca} />
      </View>
      {loading ? <ActivityIndicator color="#1D9E75" style={{ marginTop: 32 }} /> : (
        <FlatList
          data={filtrados}
          keyExtractor={p => p.id}
          contentContainerStyle={{ padding: 16 }}
          renderItem={({ item }) => (
            <TouchableOpacity style={styles.pacienteCard} onPress={() => onSelectPaciente(item)} activeOpacity={0.7}>
              <View style={styles.pacienteAvatar}>
                <Text style={styles.pacienteAvatarText}>{item.name?.charAt(0).toUpperCase()}</Text>
              </View>
              <View style={styles.pacienteCardInfo}>
                <Text style={styles.pacienteCardNome}>{item.name}</Text>
                {item.email ? <Text style={styles.pacienteCardEmail}>{item.email}</Text> : null}
              </View>
              <Text style={styles.pacienteArrow}>›</Text>
            </TouchableOpacity>
          )}
          ListEmptyComponent={<Text style={styles.emptyText}>Nenhum paciente encontrado</Text>}
        />
      )}
    </View>
  );
}

// ─── ABA DIETA MÉDICO ─────────────────────────────────────────────────────────
function TabDietaMedico({ doctor }) {
  const DIAS = ['Dom','Seg','Ter','Qua','Qui','Sex','Sáb'];
  const REFEICOES = [
    { key: 'cafe_manha', label: 'Café da manhã' },
    { key: 'lanche_manha', label: 'Lanche da manhã' },
    { key: 'almoco', label: 'Almoço' },
    { key: 'lanche_tarde', label: 'Lanche da tarde' },
    { key: 'jantar', label: 'Jantar' },
    { key: 'ceia', label: 'Ceia' },
  ];

  const [planos, setPlanos] = useState([]);
  const [pacientes, setPacientes] = useState([]);
  const [loading, setLoading] = useState(true);
  const [criando, setCriando] = useState(false);
  const [titulo, setTitulo] = useState('');
  const [pacienteSel, setPacienteSel] = useState(null);
  const [diaAtivo, setDiaAtivo] = useState(1);
  const [itens, setItens] = useState({});
  const [salvando, setSalvando] = useState(false);

  useEffect(() => {
    if (!doctor?.id) return;
    Promise.all([
      sb.from('meal_plans').select('id, title, created_at, patients(name)').eq('doctor_id', doctor.id).order('created_at', { ascending: false }),
      sb.from('patients').select('id, name').eq('doctor_id', doctor.id).order('name'),
    ]).then(([p, pat]) => {
      setPlanos(p.data || []);
      setPacientes(pat.data || []);
      setLoading(false);
    });
  }, [doctor?.id]);

  function updateItem(dia, refeicao, campo, valor) {
    setItens(prev => ({
      ...prev,
      [dia]: { ...prev[dia], [refeicao]: { ...(prev[dia]?.[refeicao] || {}), [campo]: valor } }
    }));
  }

  async function salvarPlano() {
    if (!titulo || !pacienteSel) { Alert.alert('Preencha o título e selecione o paciente'); return; }
    setSalvando(true);
    try {
      const { data: plano } = await sb.from('meal_plans').insert([{
        doctor_id: doctor.id,
        patient_id: pacienteSel.id,
        title: titulo,
      }]).select().single();

      const rows = [];
      Object.entries(itens).forEach(([dia, refeicoes]) => {
        Object.entries(refeicoes).forEach(([meal_time, item]) => {
          if (item.foods || item.supplements) {
            rows.push({ meal_plan_id: plano.id, day_of_week: parseInt(dia), meal_time, foods: item.foods || null, quantities: item.quantities || null, supplements: item.supplements || null });
          }
        });
      });
      if (rows.length > 0) await sb.from('meal_plan_items').insert(rows);

      setPlanos(prev => [{ ...plano, patients: pacienteSel }, ...prev]);
      setCriando(false);
      setTitulo('');
      setPacienteSel(null);
      setItens({});
      Alert.alert('Plano salvo e enviado ao paciente!');
    } catch(e) {
      Alert.alert('Erro ao salvar plano');
    }
    setSalvando(false);
  }

  async function apagarPlano(id) {
    await sb.from('meal_plan_items').delete().eq('meal_plan_id', id);
    await sb.from('meal_plans').delete().eq('id', id);
    setPlanos(prev => prev.filter(p => p.id !== id));
  }

  if (loading) return <ActivityIndicator color="#1D9E75" style={{ marginTop: 40 }} />;

  return (
    <ScrollView style={styles.scroll} contentContainerStyle={styles.scrollContent} keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
      <View style={styles.pageHeaderSimples}>
        <Text style={styles.pageTitle}>Plano Alimentar</Text>
        <Text style={styles.pageSubtitleSmall}>Crie e envie dietas para seus pacientes</Text>
      </View>

      {!criando ? (
        <>
          <TouchableOpacity style={styles.ctaBtn} onPress={() => setCriando(true)}>
            <Ionicons name="add-circle-outline" size={20} color="white" />
            <Text style={styles.ctaText}>Novo plano alimentar</Text>
          </TouchableOpacity>

          {planos.length === 0 ? (
            <View style={styles.emptyContainer}>
              <Text style={styles.emptyTitle}>Nenhum plano criado</Text>
              <Text style={styles.emptyDesc}>Crie planos alimentares semanais para seus pacientes.</Text>
            </View>
          ) : planos.map(p => (
            <View key={p.id} style={styles.retornoCard}>
              <View style={styles.retornoInfo}>
                <Text style={styles.retornoNome}>{p.title}</Text>
                <Text style={styles.retornoData}>{p.patients?.name} · {new Date(p.created_at).toLocaleDateString('pt-BR', { day: '2-digit', month: 'short' })}</Text>
              </View>
              <TouchableOpacity onPress={() => Alert.alert('Apagar plano?', '', [{ text: 'Cancelar' }, { text: 'Apagar', onPress: () => apagarPlano(p.id), style: 'destructive' }])}>
                <Ionicons name="trash-outline" size={18} color="#e05555" />
              </TouchableOpacity>
            </View>
          ))}
        </>
      ) : (
        <>
          <View style={styles.card}>
            <Text style={styles.cardTitle}>Novo plano</Text>
            <TextInput style={styles.input} placeholder="Título (ex: Plano emagrecimento)" placeholderTextColor="#999" value={titulo} onChangeText={setTitulo} />
            <Text style={[styles.label, { marginTop: 12 }]}>Paciente</Text>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8, paddingVertical: 4 }}>
              {pacientes.map(p => (
                <TouchableOpacity key={p.id} style={[styles.mesBadge, pacienteSel?.id === p.id && styles.mesBadgeAtivo]} onPress={() => setPacienteSel(p)}>
                  <Text style={[styles.mesBadgeText, pacienteSel?.id === p.id && styles.mesBadgeTextAtivo]}>{p.name.split(' ')[0]}</Text>
                </TouchableOpacity>
              ))}
            </ScrollView>
          </View>

          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8, paddingHorizontal: 16, paddingBottom: 8 }}>
            {[1,2,3,4,5,6,0].map(dia => (
              <TouchableOpacity key={dia} style={[styles.diaDietaBtn, diaAtivo === dia && styles.diaDietaBtnAtivo]} onPress={() => setDiaAtivo(dia)}>
                <Text style={[styles.diaDietaText, diaAtivo === dia && styles.diaDietaTextAtivo]}>{DIAS[dia]}</Text>
              </TouchableOpacity>
            ))}
          </ScrollView>

          <View style={styles.card}>
            <Text style={styles.cardTitle}>{DIAS[diaAtivo]}</Text>
            {REFEICOES.map(ref => (
              <View key={ref.key} style={{ marginBottom: 14 }}>
                <Text style={styles.label}>{ref.label}</Text>
                <TextInput style={styles.input} placeholder="Alimentos" placeholderTextColor="#999" value={itens[diaAtivo]?.[ref.key]?.foods || ''} onChangeText={v => updateItem(diaAtivo, ref.key, 'foods', v)} />
                <View style={{ flexDirection: 'row', gap: 8, marginTop: 6 }}>
                  <TextInput style={[styles.input, { flex: 1 }]} placeholder="Quantidade" placeholderTextColor="#999" value={itens[diaAtivo]?.[ref.key]?.quantities || ''} onChangeText={v => updateItem(diaAtivo, ref.key, 'quantities', v)} />
                  <TextInput style={[styles.input, { flex: 1 }]} placeholder="Suplemento" placeholderTextColor="#999" value={itens[diaAtivo]?.[ref.key]?.supplements || ''} onChangeText={v => updateItem(diaAtivo, ref.key, 'supplements', v)} />
                </View>
              </View>
            ))}
          </View>

          <View style={styles.stepNavRow}>
            <TouchableOpacity style={styles.btnVoltar} onPress={() => { setCriando(false); setTitulo(''); setPacienteSel(null); setItens({}); }}>
              <Ionicons name="arrow-back" size={18} color="#666" />
              <Text style={styles.btnVoltarText}>Cancelar</Text>
            </TouchableOpacity>
            <TouchableOpacity style={[styles.btnEnviar, { flex: 1, flexDirection: 'row', gap: 6 }]} onPress={salvarPlano} disabled={salvando}>
              {salvando ? <ActivityIndicator color="white" size="small" /> : <>
                <Text style={styles.btnEnviarText}>Salvar e enviar</Text>
                <Ionicons name="send" size={16} color="white" />
              </>}
            </TouchableOpacity>
          </View>
        </>
      )}
    </ScrollView>
  );
}

// ─── ABA PERFIL MÉDICO ────────────────────────────────────────────────────────
function TabPerfilMedico({ doctor, onLogout }) {
  const [stats, setStats] = useState({ pacientes: 0, recomendacoes: 0 });
  const [retornos, setRetornos] = useState([]);
  const [mesAtual, setMesAtual] = useState(new Date());
  const [showSettings, setShowSettings] = useState(false);
  const [nome, setNome] = useState(doctor?.name || '');
  const [especialidade, setEspecialidade] = useState(doctor?.specialty || '');
  const [crm, setCrm] = useState(doctor?.crm || '');
  const [salvando, setSalvando] = useState(false);

  useEffect(() => {
    if (!doctor?.id) return;
    Promise.all([
      sb.from('patients').select('id', { count: 'exact', head: true }).eq('doctor_id', doctor.id),
      sb.from('recommendations').select('id', { count: 'exact', head: true }).eq('doctor_id', doctor.id),
      sb.from('recommendations')
        .select('return_date, patients(name)')
        .eq('doctor_id', doctor.id)
        .not('return_date', 'is', null)
        .gte('return_date', new Date().toISOString().split('T')[0])
        .order('return_date', { ascending: true })
        .limit(50),
    ]).then(([p, r, ret]) => {
      setStats({ pacientes: p.count || 0, recomendacoes: r.count || 0 });
      setRetornos(ret.data || []);
    });
  }, [doctor?.id]);

  async function salvarPerfil() {
    setSalvando(true);
    await sb.from('doctors').update({ name: nome, specialty: especialidade, crm }).eq('id', doctor.id);
    setSalvando(false);
    setShowSettings(false);
    Alert.alert('Perfil atualizado!');
  }

  const inicial = doctor?.name?.charAt(0)?.toUpperCase() || 'D';
  const pontos = stats.recomendacoes;

  const ano = mesAtual.getFullYear();
  const mes = mesAtual.getMonth();
  const primeiroDia = new Date(ano, mes, 1).getDay();
  const diasNoMes = new Date(ano, mes + 1, 0).getDate();
  const MESES = ['Jan','Fev','Mar','Abr','Mai','Jun','Jul','Ago','Set','Out','Nov','Dez'];
  const DIAS_SEMANA = ['D','S','T','Q','Q','S','S'];

  const diasComRetorno = new Set(
    retornos
      .filter(r => {
        const d = new Date(r.return_date + 'T12:00:00');
        return d.getFullYear() === ano && d.getMonth() === mes;
      })
      .map(r => new Date(r.return_date + 'T12:00:00').getDate())
  );

  const hoje = new Date();

  return (
    <ScrollView style={styles.scroll} contentContainerStyle={styles.scrollContent} showsVerticalScrollIndicator={false}>

      <View style={{ position: 'relative' }}>
        <TouchableOpacity
          style={{ position: 'absolute', top: 0, right: 0, padding: 8, zIndex: 10 }}
          onPress={() => setShowSettings(!showSettings)}
        >
          <Ionicons name={showSettings ? "close-circle-outline" : "settings-outline"} size={24} color="#888" />
        </TouchableOpacity>
        <View style={styles.perfilDocHeader}>
          <View style={styles.perfilDocAvatar}>
            <Text style={styles.perfilDocAvatarText}>{inicial}</Text>
          </View>
          <Text style={styles.perfilDocNome}>{doctor?.name || 'Médico'}</Text>
          {doctor?.specialty ? <Text style={styles.perfilDocEsp}>{doctor.specialty}</Text> : null}
          {doctor?.crm ? <Text style={styles.perfilDocCrm}>CRM {doctor.crm}</Text> : null}
        </View>
      </View>

      <View style={styles.statsRow}>
        <View style={styles.statCard}>
          <Ionicons name="people-outline" size={20} color="#1D9E75" style={{ marginBottom: 6 }} />
          <Text style={styles.statNum}>{stats.pacientes}</Text>
          <Text style={styles.statLabel}>Pacientes</Text>
        </View>
        <View style={styles.statCard}>
          <Ionicons name="document-text-outline" size={20} color="#1D9E75" style={{ marginBottom: 6 }} />
          <Text style={styles.statNum}>{stats.recomendacoes}</Text>
          <Text style={styles.statLabel}>Receitas</Text>
        </View>
        <View style={styles.statCard}>
          <Ionicons name="star-outline" size={20} color="#1D9E75" style={{ marginBottom: 6 }} />
          <Text style={styles.statNum}>{pontos}</Text>
          <Text style={styles.statLabel}>Synka Points</Text>
        </View>
      </View>

      <View style={styles.card}>
        <View style={styles.calNavRow}>
          <TouchableOpacity onPress={() => setMesAtual(new Date(ano, mes - 1, 1))} style={styles.calNavBtn}>
            <Ionicons name="chevron-back" size={18} color="#666" />
          </TouchableOpacity>
          <Text style={styles.calMesTitulo}>{MESES[mes]} {ano}</Text>
          <TouchableOpacity onPress={() => setMesAtual(new Date(ano, mes + 1, 1))} style={styles.calNavBtn}>
            <Ionicons name="chevron-forward" size={18} color="#666" />
          </TouchableOpacity>
        </View>
        <View style={styles.calGrid}>
          {DIAS_SEMANA.map((d, i) => (
            <Text key={i} style={styles.calDiaSemana}>{d}</Text>
          ))}
          {Array.from({ length: primeiroDia }).map((_, i) => (
            <View key={'empty-' + i} style={styles.calCelula} />
          ))}
          {Array.from({ length: diasNoMes }).map((_, i) => {
            const dia = i + 1;
            const temRetorno = diasComRetorno.has(dia);
            const ehHoje = hoje.getDate() === dia && hoje.getMonth() === mes && hoje.getFullYear() === ano;
            return (
              <View key={dia} style={[styles.calCelula, ehHoje && styles.calCelulaHoje, temRetorno && styles.calCelulaRetorno]}>
                <Text style={[styles.calDiaNum, ehHoje && styles.calDiaNumHoje, temRetorno && styles.calDiaNumRetorno]}>{dia}</Text>
                {temRetorno && <View style={styles.calPonto} />}
              </View>
            );
          })}
        </View>
        {retornos.filter(r => {
          const d = new Date(r.return_date + 'T12:00:00');
          return d.getFullYear() === ano && d.getMonth() === mes;
        }).map((r, i) => (
          <View key={i} style={styles.calRetornoItem}>
            <View style={styles.calRetornoDot} />
            <Text style={styles.calRetornoNome}>{r.patients?.name}</Text>
            <Text style={styles.calRetornoData}>{new Date(r.return_date + 'T12:00:00').toLocaleDateString('pt-BR', { day: '2-digit', month: 'short' })}</Text>
          </View>
        ))}
        {diasComRetorno.size === 0 && (
          <Text style={{ fontSize: 13, color: '#bbb', textAlign: 'center', paddingVertical: 8 }}>Nenhum retorno neste mês</Text>
        )}
      </View>

      <Modal visible={showSettings} animationType="slide" presentationStyle="pageSheet" onRequestClose={() => setShowSettings(false)}>
        <SafeAreaView style={{ flex: 1, backgroundColor: '#f5f7f6' }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 20, paddingVertical: 16, backgroundColor: 'white', borderBottomWidth: 1, borderBottomColor: '#f0f0f0' }}>
            <Text style={{ fontSize: 18, fontWeight: '700', color: '#0f1f1a' }}>Configurações</Text>
            <TouchableOpacity onPress={() => setShowSettings(false)} style={{ padding: 4 }}>
              <Ionicons name="close" size={24} color="#666" />
            </TouchableOpacity>
          </View>

          <ScrollView contentContainerStyle={{ padding: 20 }}>
            <View style={{ alignItems: 'center', marginBottom: 24 }}>
              <View style={[styles.perfilDocAvatar, { width: 80, height: 80, borderRadius: 40 }]}>
                <Text style={[styles.perfilDocAvatarText, { fontSize: 32 }]}>{doctor?.name?.charAt(0)?.toUpperCase() || 'D'}</Text>
              </View>
              <Text style={{ fontSize: 13, color: '#1D9E75', fontWeight: '600', marginTop: 8 }}>Foto em breve</Text>
            </View>

            <View style={styles.card}>
              <Text style={[styles.cardTitle, { marginBottom: 14 }]}>Dados da conta</Text>
              <Text style={styles.label}>Nome completo</Text>
              <TextInput style={[styles.input, { marginBottom: 12 }]} value={nome} onChangeText={setNome} placeholder="Seu nome" placeholderTextColor="#999" />
              <Text style={styles.label}>Especialidade</Text>
              <TextInput style={[styles.input, { marginBottom: 12 }]} value={especialidade} onChangeText={setEspecialidade} placeholder="Ex: Dermatologista" placeholderTextColor="#999" />
              <Text style={styles.label}>CRM</Text>
              <TextInput style={[styles.input, { marginBottom: 12 }]} value={crm} onChangeText={setCrm} placeholder="Ex: 12345-SP" placeholderTextColor="#999" />
              <Text style={[styles.label, { color: '#bbb' }]}>Email</Text>
              <View style={[styles.input, { marginBottom: 4, backgroundColor: '#f0f0f0' }]}>
                <Text style={{ fontSize: 14, color: '#aaa' }}>{doctor?.email || '—'}</Text>
              </View>
              <Text style={{ fontSize: 11, color: '#bbb', marginBottom: 12 }}>Email não pode ser alterado</Text>
            </View>

            <TouchableOpacity
              style={[styles.btnEnviar, { flexDirection: 'row', justifyContent: 'center', gap: 8, marginBottom: 16 }]}
              onPress={salvarPerfil}
              disabled={salvando}
            >
              {salvando
                ? <ActivityIndicator color="white" size="small" />
                : <>
                    <Ionicons name="checkmark-circle-outline" size={18} color="white" />
                    <Text style={styles.btnEnviarText}>Salvar alterações</Text>
                  </>
              }
            </TouchableOpacity>

            <TouchableOpacity style={styles.sairBtn} onPress={() => { setShowSettings(false); onLogout(); }}>
              <Ionicons name="log-out-outline" size={18} color="#e05555" />
              <Text style={styles.sairBtnText}>Sair da conta</Text>
            </TouchableOpacity>
          </ScrollView>
        </SafeAreaView>
      </Modal>

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
  navIcon: { fontSize: 18, color: '#aaa' }, navIconActive: { color: '#1D9E75' }, navDot: { width: 4, height: 4, borderRadius: 2, backgroundColor: 'transparent' },
  navDotActive: { backgroundColor: '#1D9E75' },
  navLabel: { fontSize: 11, color: '#aaa', fontWeight: '500' },
  navLabelActive: { color: '#1D9E75', fontWeight: '700' },
  fichaHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', backgroundColor: 'white', paddingHorizontal: 16, paddingVertical: 14, borderBottomWidth: 1, borderBottomColor: '#eee' },
  fichaTitle: { fontSize: 16, fontWeight: '700', color: '#0f1f1a', flex: 1, textAlign: 'center' },
  backBtn: { padding: 4 },
  backBtnText: { color: '#1D9E75', fontSize: 14, fontWeight: '600' },
  fichaInfo: { backgroundColor: 'white', borderRadius: 12, padding: 16, marginBottom: 20 },
  fichaDetalhe: { fontSize: 14, color: '#444', marginBottom: 6 },
  mesBadge: { paddingHorizontal: 14, paddingVertical: 7, borderRadius: 20, borderWidth: 1, borderColor: '#ddd', backgroundColor: 'white' },
  mesBadgeAtivo: { backgroundColor: '#1D9E75', borderColor: '#1D9E75' },
  mesBadgeText: { fontSize: 13, color: '#555', fontWeight: '500' },
  mesBadgeTextAtivo: { color: 'white', fontWeight: '700' },
  calCard: { backgroundColor: 'white', borderRadius: 16, padding: 16, marginBottom: 16, shadowColor: '#000', shadowOpacity: 0.04, shadowRadius: 8, elevation: 2 },
  calTitulo: { fontSize: 15, fontWeight: '700', color: '#0f1f1a', textAlign: 'center', marginBottom: 12 },
  calSemana: { flexDirection: 'row', marginBottom: 6 },
  calDiaSemana: { flex: 1, textAlign: 'center', fontSize: 11, fontWeight: '600', color: '#999', textTransform: 'uppercase' },
  calGrid: { flexDirection: 'row', flexWrap: 'wrap' },
  calCelula: { width: '14.28%', aspectRatio: 1, alignItems: 'center', justifyContent: 'center', padding: 2 },
  calCelulaConsulta: { backgroundColor: '#e8f5f0', borderRadius: 8 },
  calCelulaSelecionada: { backgroundColor: '#1D9E75', borderRadius: 8 },
  calDiaNum: { fontSize: 13, color: '#333' },
  calDiaNumConsulta: { color: '#1D9E75', fontWeight: '700' },
  calDiaNumSelecionado: { color: 'white', fontWeight: '700' },
  calDot: { width: 4, height: 4, borderRadius: 2, backgroundColor: '#1D9E75', marginTop: 1 },
  calCelulaRetorno: { backgroundColor: '#fff7e6', borderRadius: 8 },
  calDiaNumRetorno: { color: '#f59e0b', fontWeight: '700' },
  tipoBadge: { paddingHorizontal: 8, paddingVertical: 3, borderRadius: 8, marginBottom: 6 },
  tipoBadgeConsulta: { backgroundColor: '#e8f5f0' },
  tipoBadgeRetorno: { backgroundColor: '#fff7e6' },
  tipoBadgeText: { fontSize: 11, fontWeight: '700' },
  tipoBadgeTextConsulta: { color: '#1D9E75' },
  tipoBadgeTextRetorno: { color: '#f59e0b' },
  historicoCard: { backgroundColor: 'white', borderRadius: 12, padding: 14, marginBottom: 10 },
  historicoHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 },
  historicoData: { fontSize: 13, fontWeight: '600', color: '#0f1f1a' },
  historicoProduto: { fontSize: 13, color: '#444', marginBottom: 3 },
  historicoObs: { fontSize: 12, color: '#888', marginTop: 6, fontStyle: 'italic' },
  pageHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 24 },
  pageHeaderSimples: { padding: 20, paddingBottom: 16, backgroundColor: 'white', borderBottomWidth: 1, borderBottomColor: '#eee' },
  pageGreeting: { fontSize: 22, fontWeight: '700', color: '#0f1f1a' },
  pageSubtitle: { fontSize: 13, color: '#6b9e8e', marginTop: 2 },
  pageTitle: { fontSize: 20, fontWeight: '700', color: '#0f1f1a' },
  pageSubtitleSmall: { fontSize: 12, color: '#999', marginTop: 2 },
  logoutBtn: { padding: 8, backgroundColor: '#f0f0f0', borderRadius: 8 },
  logoutText: { fontSize: 13, color: '#666' },
  statsRow: { flexDirection: 'row', gap: 10, marginBottom: 20 },
  perfilDocHeader: { alignItems: 'center', paddingTop: 24, paddingBottom: 20 },
  perfilDocAvatar: { width: 80, height: 80, borderRadius: 40, backgroundColor: '#d4ede6', alignItems: 'center', justifyContent: 'center', marginBottom: 14 },
  perfilDocAvatarText: { fontSize: 32, fontWeight: '700', color: '#1D9E75' },
  perfilDocNome: { fontSize: 22, fontWeight: '700', color: '#0f1f1a', marginBottom: 4 },
  perfilDocEsp: { fontSize: 14, color: '#888', marginBottom: 2 },
  perfilDocCrm: { fontSize: 12, color: '#aaa' },
  sairBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, backgroundColor: '#fff0f0', borderRadius: 14, padding: 16, marginTop: 8, marginBottom: 32 },
  sairBtnText: { fontSize: 15, fontWeight: '700', color: '#e05555' },
  sectionHeaderRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 },
  filtroBtn: { flexDirection: 'row', alignItems: 'center', gap: 4, backgroundColor: '#f0f9f5', borderRadius: 8, paddingHorizontal: 10, paddingVertical: 5 },
  filtroBtnText: { fontSize: 12, color: '#1D9E75', fontWeight: '600' },
  filtrosBox: { backgroundColor: '#f8f8f8', borderRadius: 12, padding: 14, marginBottom: 12 },
  filtroLabel: { fontSize: 11, fontWeight: '700', color: '#888', textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 8 },
  filtroOpcoes: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  filtroOpcao: { paddingHorizontal: 12, paddingVertical: 6, borderRadius: 20, backgroundColor: '#eee' },
  filtroOpcaoAtiva: { backgroundColor: '#1D9E75' },
  filtroOpcaoText: { fontSize: 12, color: '#666', fontWeight: '500' },
  filtroOpcaoTextAtiva: { color: 'white', fontWeight: '700' },
  filtroSalvarBtn: { backgroundColor: '#1D9E75', borderRadius: 10, padding: 12, alignItems: 'center', marginTop: 14 },
  filtroSalvarText: { color: 'white', fontWeight: '700', fontSize: 14 },
  calNavBtn: { padding: 6 },
  calMesTitulo: { fontSize: 15, fontWeight: '700', color: '#0f1f1a' },
  calNavRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 },
  calCelulaHoje: { backgroundColor: '#e8f5f0', borderRadius: 20 },
  calDiaNumHoje: { color: '#1D9E75', fontWeight: '700' },
  calPonto: { width: 4, height: 4, borderRadius: 2, backgroundColor: 'white', marginTop: 1 },
  calRetornoItem: { flexDirection: 'row', alignItems: 'center', paddingVertical: 8, borderTopWidth: 1, borderTopColor: '#f5f5f5', gap: 8 },
  calRetornoDot: { width: 8, height: 8, borderRadius: 4, backgroundColor: '#1D9E75' },
  calRetornoNome: { flex: 1, fontSize: 13, color: '#333', fontWeight: '500' },
  calRetornoData: { fontSize: 12, color: '#888' },
  statCard: { flex: 1, backgroundColor: 'white', borderRadius: 16, padding: 16, alignItems: 'center', shadowColor: '#000', shadowOpacity: 0.04, shadowRadius: 8, elevation: 2 },
  statNum: { fontSize: 28, fontWeight: '800', color: '#0f1f1a' },
  statLabel: { fontSize: 12, color: '#999', marginTop: 2 },
  section: { marginBottom: 20 },
  sectionTitle: { fontSize: 14, fontWeight: '700', color: '#0f1f1a', marginBottom: 12 },
  retornoCard: { backgroundColor: 'white', borderRadius: 12, padding: 14, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8, shadowColor: '#000', shadowOpacity: 0.04, shadowRadius: 6, elevation: 1 },
  retornoInfo: { flex: 1 },
  retornoNome: { fontSize: 15, fontWeight: '600', color: '#0f1f1a' },
  retornoData: { fontSize: 12, color: '#999', marginTop: 2 },
  retornoBadge: { backgroundColor: '#e8f5f0', borderRadius: 8, paddingHorizontal: 10, paddingVertical: 4 },
  retornoBadgeText: { fontSize: 12, color: '#1D9E75', fontWeight: '600' },
  retornoProduto: { fontSize: 11, color: '#888', marginTop: 3 },
  retornoAcoes: { alignItems: 'flex-end', gap: 8 },
  retornoWaBtn: { width: 36, height: 36, borderRadius: 18, backgroundColor: '#e8f5f0', alignItems: 'center', justifyContent: 'center' },
  retornoWaText: { fontSize: 18 },
  card: { backgroundColor: 'white', borderRadius: 16, padding: 16, marginBottom: 16, shadowColor: '#000', shadowOpacity: 0.04, shadowRadius: 8, elevation: 2 },
  cardTitle: { fontSize: 14, fontWeight: '700', color: '#0f1f1a', marginBottom: 12 },
  cardTitleRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 },
  addBtn: { backgroundColor: '#f0f9f5', borderRadius: 8, paddingHorizontal: 12, paddingVertical: 6 },
  addBtnText: { color: '#1D9E75', fontWeight: '600', fontSize: 13 },
  input: { backgroundColor: '#f8f8f8', borderRadius: 10, padding: 13, fontSize: 15, color: '#0f1f1a', borderWidth: 1, borderColor: '#eee' },
  pacienteSelecionado: { flexDirection: 'row', alignItems: 'center', backgroundColor: '#f0f9f5', borderRadius: 10, padding: 12 },
  pacienteInfo: { flex: 1 },
  pacienteNome: { fontSize: 15, fontWeight: '600', color: '#0f1f1a' },
  pacienteEmail: { fontSize: 12, color: '#999', marginTop: 2 },
  trocarText: { color: '#1D9E75', fontWeight: '600', fontSize: 13 },
  sugestaoItem: { padding: 12, borderBottomWidth: 1, borderBottomColor: '#f0f0f0' },
  sugestaoNome: { fontSize: 14, fontWeight: '600', color: '#0f1f1a' },
  sugestaoEmail: { fontSize: 12, color: '#999' },
  novoPacienteBtn: { marginTop: 10, padding: 10, alignItems: 'center' },
  novoPacienteText: { color: '#1D9E75', fontWeight: '600', fontSize: 14 },
  novoRow: { flexDirection: 'row', gap: 8, marginTop: 10 },
  btnPrimario: { flex: 1, backgroundColor: '#1D9E75', borderRadius: 10, padding: 12, alignItems: 'center' },
  btnPrimarioText: { color: 'white', fontWeight: '700' },
  btnSecundario: { flex: 1, backgroundColor: '#f0f0f0', borderRadius: 10, padding: 12, alignItems: 'center' },
  btnSecundarioText: { color: '#666', fontWeight: '600' },
  produtoItem: { flexDirection: 'row', alignItems: 'center', padding: 12, borderRadius: 10, borderWidth: 1, borderColor: '#eee', marginBottom: 6, backgroundColor: '#fafafa' },
  produtoItemAtivo: { borderColor: '#1D9E75', backgroundColor: '#f0f9f5' },
  produtoInfo: { flex: 1 },
  produtoNome: { fontSize: 14, fontWeight: '600', color: '#0f1f1a' },
  produtoNomeAtivo: { color: '#1D9E75' },
  produtoCategoria: { fontSize: 11, color: '#999', marginTop: 2 },
  produtoCheck: { fontSize: 18, color: '#ccc', fontWeight: '700' },
  produtoCheckAtivo: { color: '#1D9E75' },
  manipuladoCard: { backgroundColor: '#fafafa', borderRadius: 10, padding: 12, marginBottom: 10, borderWidth: 1, borderColor: '#eee' },
  removeBtn: { marginTop: 8, alignItems: 'flex-end' },
  removeBtnText: { color: '#e53935', fontSize: 13, fontWeight: '600' },
  emptySmall: { fontSize: 13, color: '#aaa', textAlign: 'center', paddingVertical: 8 },
  instrucaoLabel: { fontSize: 13, fontWeight: '600', color: '#444', marginBottom: 6 },
  btnEnviar: { backgroundColor: '#1D9E75', borderRadius: 14, paddingHorizontal: 20, paddingVertical: 16, alignItems: 'center', justifyContent: 'center' },
  btnEnviarText: { color: 'white', fontWeight: '700', fontSize: 16 },
  stepHeader: { flexDirection: 'row', justifyContent: 'center', alignItems: 'center', marginBottom: 24, gap: 20 },
  stepItem: { alignItems: 'center', gap: 4 },
  stepCircle: { width: 30, height: 30, borderRadius: 15, backgroundColor: '#f0f0f0', alignItems: 'center', justifyContent: 'center' },
  stepCircleAtivo: { backgroundColor: '#1D9E75' },
  stepCircleFeito: { backgroundColor: '#1D9E75' },
  stepNum: { fontSize: 13, fontWeight: '700', color: '#aaa' },
  stepLabel: { fontSize: 11, color: '#aaa', fontWeight: '500' },
  stepLabelAtivo: { color: '#1D9E75', fontWeight: '700' },
  stepNavRow: { flexDirection: 'row', gap: 12, marginBottom: 24, alignItems: 'stretch' },
  btnVoltar: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, backgroundColor: '#f0f0f0', borderRadius: 14, paddingHorizontal: 20, paddingVertical: 16 },
  btnVoltarText: { fontSize: 14, color: '#666', fontWeight: '600' },
  resumoRow: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 8, borderBottomWidth: 1, borderBottomColor: '#f5f5f5' },
  resumoLabel: { fontSize: 13, color: '#888' },
  resumoValor: { fontSize: 13, fontWeight: '600', color: '#0f1f1a' },
  resumoItem: { fontSize: 13, color: '#444', paddingVertical: 4, paddingLeft: 8 },
  successContainer: { flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: '#f5f7f6' },
  successIcon: { fontSize: 56, color: '#1D9E75', marginBottom: 16 },
  successTitle: { fontSize: 22, fontWeight: '700', color: '#0f1f1a' },
  successSub: { fontSize: 14, color: '#999', marginTop: 6 },
  searchBar: { padding: 16, backgroundColor: 'white', borderBottomWidth: 1, borderBottomColor: '#eee' },
  searchInput: { backgroundColor: '#f5f5f5', borderRadius: 10, padding: 12, fontSize: 15, color: '#0f1f1a' },
  pacienteCard: { flexDirection: 'row', alignItems: 'center', backgroundColor: 'white', borderRadius: 12, padding: 14, marginBottom: 8, shadowColor: '#000', shadowOpacity: 0.03, shadowRadius: 6, elevation: 1 },
  pacienteAvatar: { width: 44, height: 44, borderRadius: 22, backgroundColor: '#e8f5f0', alignItems: 'center', justifyContent: 'center', marginRight: 12 },
  pacienteAvatarText: { fontSize: 18, fontWeight: '700', color: '#1D9E75' },
  pacienteCardInfo: { flex: 1 },
  pacienteCardNome: { fontSize: 15, fontWeight: '600', color: '#0f1f1a' },
  pacienteCardEmail: { fontSize: 12, color: '#999', marginTop: 2 },
  pacienteArrow: { fontSize: 22, color: '#ccc' },
  emptyText: { textAlign: 'center', color: '#999', marginTop: 40, fontSize: 14 },
  emptyContainer: { alignItems: 'center', paddingVertical: 60 },
  emptyTitle: { fontSize: 16, fontWeight: '600', color: '#444', marginBottom: 6 },
  emptyDesc: { fontSize: 13, color: '#999', textAlign: 'center', paddingHorizontal: 32 },
  top5NumSmall: { width: 22, height: 22, borderRadius: 11, backgroundColor: '#e8f5f0', alignItems: 'center', justifyContent: 'center', marginRight: 10 },
  top5NumSmallText: { fontSize: 11, fontWeight: '700', color: '#1D9E75' },
  ctaBtn: { backgroundColor: '#1D9E75', borderRadius: 14, padding: 16, alignItems: 'center', marginBottom: 24 },
  ctaText: { color: 'white', fontWeight: '700', fontSize: 15 },
  recenteCard: { backgroundColor: 'white', borderRadius: 12, padding: 14, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 },
  recenteNome: { fontSize: 14, fontWeight: '600', color: '#0f1f1a' },
  recenteData: { fontSize: 12, color: '#999' },
  componenteRow: { flexDirection: 'row', alignItems: 'center', marginBottom: 6 },
  manipRow: { flexDirection: 'row', gap: 6, marginTop: 6 },
  addComponenteBtn: { marginTop: 4, marginBottom: 8, paddingVertical: 6 },
  addComponenteBtnText: { fontSize: 12, color: '#1D9E75', fontWeight: '600' },
  diaDietaBtn: { paddingHorizontal: 18, paddingVertical: 10, borderRadius: 20, backgroundColor: '#f0f0f0', borderWidth: 1.5, borderColor: 'transparent' },
  diaDietaBtnAtivo: { backgroundColor: '#1D9E75', borderColor: '#1D9E75' },
  diaDietaText: { fontSize: 14, fontWeight: '600', color: '#666' },
  diaDietaTextAtivo: { color: 'white', fontWeight: '700' },
  waIconBtn: { padding: 8 },
  label: { fontSize: 12, fontWeight: '600', color: '#888', marginBottom: 4 },
});