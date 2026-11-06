import { useEffect, useState } from 'react';
import { Image, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import Animated, { FadeIn, ReduceMotion } from 'react-native-reanimated';
import { closeDatabase, database, type Setup } from '../storage/client';
const cream='#f9f5eb', ink='#293c32', sage='#486b51';
/** Render local setup and the first saved account; storage failures always stay visible. */
export default function Home() {
 const [saved,setSaved]=useState<Setup|null>(null), [phase,setPhase]=useState('loading');
 const [name,setName]=useState(''),[account,setAccount]=useState('Cash'),[amount,setAmount]=useState('0');
 const [step,setStep]=useState(0),[error,setError]=useState(''),[saving,setSaving]=useState(false);
 /** Read canonical setup; retry startup with a fresh worker after any failure. */
 async function load() {
  setPhase('loading');setError('');
  try {await closeDatabase();setSaved(await database('state'));setPhase('ready');}
  catch(e) {setError((e as Error).message);setPhase('error');}
 }
 useEffect(()=>{void load();if('serviceWorker' in navigator) void navigator.serviceWorker.register('/sw.js').catch(()=>setError('Offline caching failed. Stay online and reload to retry.'));},[]);
 /** Convert the verified PHP decimal input to centavos, then commit setup atomically. */
 async function finish() {
  if(!/^\d+(\.\d{0,2})?$/.test(amount)) {setError('Enter a PHP amount with at most two decimal places.');return;}
  const [whole,fraction='']=amount.split('.');const minor=Number(whole)*100+Number(fraction.padEnd(2,'0'));
  if(!Number.isSafeInteger(minor)) {setError('This amount is too large.');return;}
  setSaving(true);setError('');
  try {setSaved(await database('complete',{name,account,amountMinor:minor}));}
  catch(e) {setError((e as Error).message);} finally {setSaving(false);}
 }
 /** Close files before releasing ownership so another tab may safely open them. */
 async function close() {try{await closeDatabase();setPhase('closed');}catch(e){setError((e as Error).message);}}
 /** Render a labeled action with a real disabled state during validation or saving. */
 const button=(label:string,onPress:()=>void,disabled=false)=><Pressable accessibilityRole="button" disabled={disabled} onPress={onPress} style={[s.button,disabled&&s.disabled]}><Text style={s.buttonText}>{label}</Text></Pressable>;
 return <ScrollView contentContainerStyle={s.page} keyboardShouldPersistTaps="handled"><View style={s.shell}>
 <Text style={s.brand}>kuwi</Text>
 {error ? <Text accessibilityRole="alert" style={s.error}>{error}</Text>:null}
 {phase==='loading'?<Text style={s.copy}>Opening your local account…</Text>:phase==='error'||phase==='closed'?<View style={s.content}><Text style={s.title}>{phase==='closed'?'Database closed':'Unable to open your data'}</Text><Text style={s.copy}>Your existing storage stays on this device.</Text>{button('Retry opening',()=>void load())}</View>:saved?<View style={s.content}>
 <Text style={s.title}>Welcome, {saved.preferred_name}.</Text><Text style={s.copy}>Your first account is ready.</Text>
 <View style={s.account}><Text style={s.label}>{saved.account_name}</Text><Text style={s.balance}>{new Intl.NumberFormat('en-PH',{style:'currency',currency:saved.currency_code}).format(saved.opening_balance_minor/100)}</Text></View>
 <Text style={s.copy}>Saved on this device. No sign-in required.</Text>{button('Close database',()=>void close())}
 </View>:<View style={s.content}>
 <Animated.View entering={FadeIn.duration(440).reduceMotion(ReduceMotion.System)}><Image source={{uri:'/quokka.png'}} style={s.mascot} accessibilityLabel="Kuwi the quokka"/></Animated.View>
 {step===0?<><Text style={s.title}>Make yourself at home.</Text><Text style={s.copy}>Start with your name and the money you have today.</Text>{button('Continue offline',()=>setStep(1))}<Text style={s.note}>Safari and the Home Screen app keep separate local data.</Text></>:step===1?<>
 <Text style={s.title}>What should Kuwi call you?</Text><Text style={s.label}>Preferred name</Text><TextInput accessibilityLabel="Preferred name" value={name} onChangeText={setName} autoComplete="given-name" maxLength={100} style={s.input} returnKeyType="next" onSubmitEditing={()=>{if(name.trim())setStep(2);}}/>
 {button('Next',()=>setStep(2),!name.trim())}</>:step===2?<><Text style={s.title}>Your main currency</Text><Text style={s.copy}>Philippine Peso (PHP)</Text><Text style={s.note}>More currencies are pending reference verification.</Text>{button('Next',()=>setStep(3))}{button('Back',()=>setStep(1))}</>:<>
 <Text style={s.title}>Your first account</Text><Text style={s.label}>Account name</Text><TextInput accessibilityLabel="Account name" value={account} onChangeText={setAccount} style={s.input}/>
 <Text style={s.label}>Opening balance (PHP)</Text><TextInput accessibilityLabel="Opening balance (PHP)" value={amount} onChangeText={setAmount} keyboardType="decimal-pad" style={s.input}/>
 <Text style={s.note}>Leave the name blank to use Cash.</Text>{button(saving?'Saving…':'Save my account',()=>void finish(),saving)}{button('Back',()=>setStep(2),saving)}</>}
 </View>}
 </View></ScrollView>;
}
const s=StyleSheet.create({page:{flexGrow:1,backgroundColor:cream,padding:24},shell:{width:'100%',maxWidth:480,alignSelf:'center',paddingTop:24,paddingBottom:32},brand:{color:ink,fontSize:32,fontWeight:'800',marginBottom:24},content:{gap:18},title:{fontSize:32,lineHeight:38,fontWeight:'700',color:ink},copy:{fontSize:17,lineHeight:26,color:ink},label:{fontSize:16,fontWeight:'600',color:ink},note:{fontSize:14,lineHeight:22,color:'#526355'},mascot:{width:'100%',height:220,resizeMode:'contain',borderRadius:16},input:{padding:18,borderWidth:1,borderColor:'#83927e',borderRadius:14,fontSize:18,color:ink,backgroundColor:'#fffdf7'},button:{padding:18,borderRadius:14,backgroundColor:sage,alignItems:'center'},buttonText:{color:'#ffffff',fontSize:17,fontWeight:'600'},disabled:{opacity:0.5},error:{backgroundColor:'#fae7de',color:'#752e1a',padding:16,marginBottom:20,borderRadius:12},account:{backgroundColor:'#e2e9d9',padding:24,borderRadius:16,gap:12},balance:{fontSize:36,fontWeight:'600',color:ink}});
