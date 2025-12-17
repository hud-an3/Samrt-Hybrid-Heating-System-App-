import React, { useEffect, useState, useRef } from 'react';
import auth from '@react-native-firebase/auth';
import { KeyboardAvoidingView,
  View,
  Text,
  Switch,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  TextInput,
  Button,
  FlatList,
  Alert
} from 'react-native';
import { Picker } from '@react-native-picker/picker';
import database from '@react-native-firebase/database';
import { useNavigation } from '@react-navigation/native';
import Navigation from './navigation';


// --- Global Helper Function ---
async function fetchWeatherDetails() {
  try {
    // IMPORTANT: Replace YOUR_LAT, YOUR_LON with actual values.
    // Store YOUR_API_KEY securely, not hardcoded in production.
    const res = await fetch(
      'https://api.openweathermap.org/data/3.0/onecall?lat=33.738045&lon=73.084488&appid=22cfcc23d77d38dd463323cc646040f6' // Removed curly braces and placeholder for API key
    );
    if (!res.ok) {
      throw new Error(`Weather API request failed with status ${res.status}`);
    }
    const json = await res.json();
    // Adjusting to typical OneCall API response structure (current weather)
    if (!json.current || !json.current.weather || json.current.weather.length === 0) {
      console.warn('Weather API response missing expected fields:', json);
      return { temperature: null, humidity: null, condition: null };
    }
    return {
      temperature: json.current.temp,
      humidity: json.current.humidity,
      condition: json.current.weather[0].main,
    };
  } catch (error) {
    console.error("fetchWeatherDetails error:", error);
    return { temperature: null, humidity: null, condition: null };
  }
}

const SystemControl = ({ title, systemPath }) => {
  const [isOn, setIsOn] = useState(false);
  const [currentTemperature, setCurrentTemperature] = useState('N/A');
  const [setTemp, setSetTemp] = useState(20);
  const [mode, setMode] = useState('Electric');

  const [scheduledTime, setScheduledTime] = useState({ hours: '', minutes: '', ampm: 'AM' });
  const [duration, setDuration] = useState('');
  const [schedules, setSchedules] = useState([]);

  const [pressure, setPressure] = useState(null);
  const [flameState, setFlameState] = useState(null);
  const [gasAvailabilityMessage, setGasAvailabilityMessage] = useState('Gas Status: Checking...');

  const scheduleTimeoutsRef = useRef({}); // Stores { scheduleId: { on: timeoutId, off: timeoutId } }

  // Log usage event
  const logUsage = async (eventType, extras = {}) => {
    try {
      const weather = await fetchWeatherDetails();
      let gasAvailableLog = null;
      // Only check gasAvailability from Firebase if the mode is 'Gas' for this specific log event
      // The 'mode' state reflects the current selection in the UI
      if (extras.modeForLog === 'Gas' || (extras.modeForLog === undefined && mode === 'Gas')) {
        try {
            const gasSnapshot = await database().ref(`${systemPath}/gasAvailability`).once('value');
            gasAvailableLog = gasSnapshot.val() || null;
        } catch (dbError) {
            console.error("Error fetching gas availability for logging:", dbError);
            gasAvailableLog = "Error fetching";
        }
      }


      await database()
        .ref(`${systemPath}/usageLogs`)
        .push({
          event: eventType,
          timestamp: new Date().toISOString(),
          currentTemp: currentTemperature, // Current temp at time of event
          setTemp: extras.setTempForLog !== undefined ? extras.setTempForLog : setTemp, // Set temp at time of event
          mode: extras.modeForLog !== undefined ? extras.modeForLog : mode, // Mode at time of event
          duration: extras.duration || null,
          timeOn: extras.timeOn || null,
          timeOff: extras.timeOff || null,
          scheduleId: extras.scheduleId || null,
          weather,
          gasAvailableForLog: gasAvailableLog
        });
    } catch (error) {
        console.error("Error in logUsage:", error);
    }
  };

  useEffect(() => {
    const systemRef = database().ref(systemPath);
    const onValueChange = systemRef.on('value', snapshot => {
      const data = snapshot.val() || {};
      setIsOn(data.isOn ?? false);
      setCurrentTemperature(data.currentTemperature ?? 'N/A');
      setSetTemp(data.setTemperature ?? 20);
      setMode(data.mode ?? 'Electric');
      setPressure(data.pressure !== undefined ? data.pressure : null);
      setFlameState(data.flameState !== undefined ? data.flameState : null);
    }, error => {
      console.error(`Error fetching system data for ${systemPath}:`, error);
      setPressure(null); // Reset on error
      setFlameState(null); // Reset on error
    });

    const schedRef = database().ref(`${systemPath}/schedules`);
    const onScheduleChange = schedRef.on('value', snapshot => {
      const val = snapshot.val() || {};
      const activeSchedules = [];
      Object.keys(val).forEach(key => {
        const schedule = { id: key, ...val[key] };
        if (schedule.isActive !== false) {
            activeSchedules.push(schedule);
            if (!scheduleTimeoutsRef.current[schedule.id] && schedule.turnOnTimeISO && schedule.turnOffTimeISO) {
                rescheduleFrontendTimeout(schedule);
            }
        } else {
            if (scheduleTimeoutsRef.current[schedule.id]) {
                clearTimeout(scheduleTimeoutsRef.current[schedule.id].on);
                clearTimeout(scheduleTimeoutsRef.current[schedule.id].off);
                delete scheduleTimeoutsRef.current[schedule.id];
            }
        }
      });
      activeSchedules.sort((a, b) => new Date(a.nextRun) - new Date(b.nextRun));
      setSchedules(activeSchedules);
    }, error => {
      console.error(`Error fetching schedules for ${systemPath}:`, error);
    });

    return () => {
      systemRef.off('value', onValueChange);
      schedRef.off('value', onScheduleChange);
      Object.values(scheduleTimeoutsRef.current).forEach(timeoutPair => {
        if (timeoutPair) {
          clearTimeout(timeoutPair.on);
          clearTimeout(timeoutPair.off);
        }
      });
      scheduleTimeoutsRef.current = {};
    };
  }, [systemPath]); // Added rescheduleFrontendTimeout to dependency array if it were not memoized

  useEffect(() => {
    if (pressure === null) {
      setGasAvailabilityMessage('Gas Status: Checking...');
      return;
    }
    const numericPressure = parseFloat(pressure);
    if (isNaN(numericPressure)) {
      setGasAvailabilityMessage('Gas Status: Pressure data invalid');
      return;
    }
    if (numericPressure > 980) {
      setGasAvailabilityMessage('Gas Available: Yes (Pressure > 980)');
    } else if (numericPressure <= 980 && flameState === 'LOW') {
      setGasAvailabilityMessage('Gas Available: Yes (Pressure <= 980 & Flame LOW)');
    } else {
      setGasAvailabilityMessage('Gas Available: No');
    }
  }, [pressure, flameState]);

  const toggleSystem = () => {
    const nextState = !isOn;
    database().ref(systemPath).update({ isOn: nextState })
      .then(() => logUsage(nextState ? 'manualOn' : 'manualOff', {setTempForLog: setTemp, modeForLog: mode}))
      .catch(error => console.error("Error toggling system:", error));
  };

  const updateTemperature = newTemp => {
    database().ref(systemPath).update({ setTemperature: newTemp })
      // Log this change if needed, e.g., logUsage('setTemperature', { newTemp: newTemp })
      .catch(error => console.error("Error updating temperature:", error));
  };

  const updateMode = selectedMode => {
    database().ref(systemPath).update({ mode: selectedMode })
      // Log this change if needed, e.g., logUsage('changeMode', { newMode: selectedMode })
     .catch(error => console.error("Error updating mode:", error));
  };

  // Placed rescheduleFrontendTimeout before scheduleSystem as it's used by it and by useEffect
  const rescheduleFrontendTimeout = (scheduleData) => {
    const { id, turnOnTimeISO, turnOffTimeISO, duration: schedDuration, mode: scheduleMode, setTemperature: scheduleSetTemp } = scheduleData;

    if (!turnOnTimeISO || !turnOffTimeISO) {
        console.warn("Schedule data missing ISO times, cannot reschedule timeout:", scheduleData);
        return;
    }

    const now = new Date();
    const turnOnDate = new Date(turnOnTimeISO);
    const turnOffDate = new Date(turnOffTimeISO);

    if (scheduleTimeoutsRef.current[id]) {
        clearTimeout(scheduleTimeoutsRef.current[id].on);
        clearTimeout(scheduleTimeoutsRef.current[id].off);
    }

    let onTimeoutId = null;
    let offTimeoutId = null;

    // Log params should reflect the state intended AT THE TIME OF THE SCHEDULED ACTION
    const logParamsOn = {
        duration: schedDuration,
        timeOn: turnOnDate.toISOString(),
        timeOff: turnOffDate.toISOString(),
        scheduleId: id,
        modeForLog: scheduleMode, // Mode set for this schedule
        setTempForLog: scheduleSetTemp // Set temp for this schedule
    };
    const logParamsOff = { ...logParamsOn }; // Base is same, specific event type will differ

    if (turnOnDate > now) {
        const msUntilOn = turnOnDate.getTime() - now.getTime();
        onTimeoutId = setTimeout(() => {
            database().ref(systemPath).update({ isOn: true, mode: scheduleMode, setTemperature: scheduleSetTemp });
            logUsage('scheduledOn', logParamsOn);
        }, msUntilOn);
    } else if (turnOnDate <= now && turnOffDate > now) {
        // If current time is past scheduled ON but before scheduled OFF
        // Check current system state before turning it on to avoid redundant writes/logs if already on due to this schedule
        const systemStateRef = database().ref(systemPath);
        systemStateRef.once('value').then(snapshot => {
            const currentData = snapshot.val();
            if (!currentData || !currentData.isOn) { // If system is OFF or data is missing
                 database().ref(systemPath).update({ isOn: true, mode: scheduleMode, setTemperature: scheduleSetTemp });
                 logUsage('scheduledOnCatchUp', {
                    ...logParamsOn,
                    timeOn: new Date().toISOString(), // Log actual turn on time for catch-up
                 });
            }
        });
    }

    if (turnOffDate > now) {
        const msUntilOff = turnOffDate.getTime() - now.getTime();
        offTimeoutId = setTimeout(() => {
            database().ref(systemPath).update({ isOn: false }); // System turns off, mode/temp might remain or reset based on device logic
            logUsage('scheduledOff', logParamsOff);
            database().ref(`${systemPath}/schedules/${id}`).update({ isActive: false, nextRun: null });
            if (scheduleTimeoutsRef.current[id]) {
                delete scheduleTimeoutsRef.current[id];
            }
        }, msUntilOff);
    } else { // turnOffDate is in the past
        database().ref(`${systemPath}/schedules/${id}`).update({ isActive: false, nextRun: null });
        if (scheduleTimeoutsRef.current[id]) {
             delete scheduleTimeoutsRef.current[id];
        }
        return;
    }

    if (onTimeoutId || offTimeoutId) {
        scheduleTimeoutsRef.current[id] = { on: onTimeoutId, off: offTimeoutId };
    }
  };

  const scheduleSystem = () => {
    let { hours, minutes, ampm } = scheduledTime;
    const dur = parseInt(duration, 10);
    let numHours = parseInt(hours, 10);
    let numMinutes = parseInt(minutes, 10);

    if (isNaN(numHours) || isNaN(numMinutes) || numHours < 1 || numHours > 12 || numMinutes < 0 || numMinutes > 59) {
      Alert.alert('Invalid Time', 'Please enter a valid time (HH: 1-12, MM: 0-59).');
      return;
    }
    if (isNaN(dur) || dur <= 0) {
      Alert.alert('Invalid Duration', 'Duration must be greater than 0 minutes.');
      return;
    }

    let hrs24 = numHours % 12; // 12 AM becomes 0, 1-11 AM remain 1-11
    if (ampm === 'PM' && numHours !== 12) hrs24 += 12; // 1-11 PM become 13-23
    if (ampm === 'AM' && numHours === 12) hrs24 = 0; // 12 AM is 00 hours
    // 12 PM is 12 hours, already handled by hrs24 = numHours % 12; (12 % 12 = 0) then not adding 12. This is wrong.
    // Corrected 12 PM:
    if (ampm === 'PM' && numHours === 12) hrs24 = 12; // 12 PM is 12 hours

    const now = new Date();
    const turnOnTime = new Date(now);
    turnOnTime.setHours(hrs24, numMinutes, 0, 0);

    if (turnOnTime <= now) {
      turnOnTime.setDate(turnOnTime.getDate() + 1);
    }

    const turnOffTime = new Date(turnOnTime.getTime() + dur * 60000);

    const newScheduleRef = database().ref(`${systemPath}/schedules`).push();
    const scheduleId = newScheduleRef.key;

    if (!scheduleId) {
      Alert.alert('Error', 'Could not create schedule ID.');
      return;
    }

    const scheduleData = {
        id: scheduleId,
        originalInput: { hours: String(numHours).padStart(2,'0'), minutes: String(numMinutes).padStart(2,'0'), ampm },
        duration: dur,
        turnOnTimeISO: turnOnTime.toISOString(),
        turnOffTimeISO: turnOffTime.toISOString(),
        nextRun: turnOnTime.toISOString(),
        mode: mode, // Capture current system mode for this schedule
        setTemperature: setTemp, // Capture current system setTemp for this schedule
        isActive: true,
        createdAt: new Date().toISOString()
    };

    newScheduleRef.set(scheduleData)
      .then(() => {
        rescheduleFrontendTimeout(scheduleData);
        Alert.alert(
          'Scheduled',
          `System "${title}" will turn ON at ${turnOnTime.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })} for ${dur} minute(s). Mode: ${scheduleData.mode}, Temp: ${scheduleData.setTemperature}°C`
        );
        setScheduledTime({ hours: '', minutes: '', ampm: 'AM' });
        setDuration('');
      })
      .catch(err => {
        console.error('Failed to schedule system:', err);
        Alert.alert('Error', 'Could not save schedule.');
      });
  };

  const deleteSchedule = id => {
    if (scheduleTimeoutsRef.current[id]) {
      clearTimeout(scheduleTimeoutsRef.current[id].on);
      clearTimeout(scheduleTimeoutsRef.current[id].off);
      delete scheduleTimeoutsRef.current[id];
    }
    // Option 1: Mark as inactive (keeps history)
    // database().ref(`${systemPath}/schedules/${id}`).update({ isActive: false, nextRun: null })
    // Option 2: Remove completely
    database().ref(`${systemPath}/schedules/${id}`).remove()
      .then(() => Alert.alert('Deleted', 'Schedule removed.'))
      .catch(error => {
        Alert.alert('Error', 'Could not delete schedule.');
        console.error("Error deleting schedule:", error);
      });
  };

  const renderSchedule = ({ item }) => {
    const displayHours = item.originalInput ? item.originalInput.hours : "--";
    const displayMinutes = item.originalInput ? item.originalInput.minutes : "--";
    const displayAmpm = item.originalInput ? item.originalInput.ampm : "";

    const displayTime = `${displayHours}:${displayMinutes} ${displayAmpm}`;

    let friendlyNextRun = "Completed";
    if (item.isActive && item.nextRun) {
        const nextRunDate = new Date(item.nextRun);
        friendlyNextRun = `${nextRunDate.toLocaleDateString()} ${nextRunDate.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`;
    }


    return (
      <View style={styles.scheduleItem}>
        <View style={styles.scheduleDetails}>
          <Text style={styles.scheduleText}>
           Time: {displayTime} for {item.duration ?? 'N/A'} min(s)
          </Text>
          <Text style={styles.scheduleNextRunText}>
            Next run: {friendlyNextRun}
          </Text>
          <Text style={styles.scheduleInfoText}>
            (Mode: {item.mode || 'N/A'}, Temp: {item.setTemperature !== undefined ? item.setTemperature + "°C" : 'N/A'})
          </Text>
        </View>
        {item.isActive && (
            <TouchableOpacity onPress={() => deleteSchedule(item.id)} style={styles.deleteButton}>
            <Text style={styles.deleteText}>Delete</Text>
            </TouchableOpacity>
        )}
      </View>
    );
  };

  return (
    <View style={styles.systemContainer}>
      <Text style={styles.title}>{title}</Text>

      <View style={styles.row}>
        <Text style={styles.label}>System Status: {isOn ? 'ON' : 'OFF'}</Text>
        <Switch value={isOn} onValueChange={toggleSystem} trackColor={{ false: "#767577", true: "#81b0ff" }} thumbColor={isOn ? "#f5dd4b" : "#f4f3f4"} />
      </View>
      <View style={styles.row}>
        <Text style={styles.label}>Current Temp:</Text>
        <Text style={styles.value}>
          {currentTemperature !== 'N/A' ? `${currentTemperature}°C` : 'N/A'}
        </Text>
      </View>
      <View style={styles.row}>
               <Text style={styles.label}>Set Temperature:</Text>
               <View style={styles.tempControl}>
                 <TouchableOpacity
                   style={styles.tempButton}
                   onPress={() => updateTemperature(setTemp - 1)}
                 >
                   <Text style={styles.buttonText}>-</Text>
                 </TouchableOpacity>
                 <Text style={styles.value}>{`${setTemp}°C`}</Text>
                 <TouchableOpacity
                   style={styles.tempButton}
                   onPress={() => updateTemperature(setTemp + 1)}
                 >
                   <Text style={styles.buttonText}>+</Text>
                 </TouchableOpacity>
               </View>
      </View>
   <View style={styles.row}>
     <Text style={styles.label}>Mode:</Text>
     <Picker
       selectedValue={mode}
       style={styles.picker}
       onValueChange={updateMode}
     >
       <Picker.Item label="Electric" value="Electric" />
       <Picker.Item label="Gas" value="Gas" />
     </Picker>
   </View>


      <View style={styles.row}>
        <Text style={styles.label}>Gas Status:</Text>
        <Text style={[styles.value, {flexShrink: 1}]}>{gasAvailabilityMessage}</Text>
      </View>
      <View style={styles.row}>
        <Text style={styles.label}>(Raw Pressure:</Text>
        <Text style={styles.value}>{pressure !== null ? pressure : 'N/A'}, Flame: {flameState !== null ? flameState : 'N/A'})</Text>
      </View>

      <Text style={styles.subHeader}>Add New Schedule</Text>
      <View style={styles.row}>
        <Text style={styles.label}>Time:</Text>
        <View style={styles.timePicker}>
          <TextInput
            style={styles.timeInput}
            placeholder="HH"
            keyboardType="numeric"
            maxLength={2}
            value={scheduledTime.hours}
            onChangeText={h => setScheduledTime(s => ({ ...s, hours: h.replace(/[^0-9]/g, '') }))}
          />
          <Text style={styles.timeSeparator}>:</Text>
          <TextInput
            style={styles.timeInput}
            placeholder="MM"
            keyboardType="numeric"
            maxLength={2}
            value={scheduledTime.minutes}
            onChangeText={m => setScheduledTime(s => ({ ...s, minutes: m.replace(/[^0-9]/g, '') }))}
          />
          <Picker
            selectedValue={scheduledTime.ampm}
            style={styles.ampmPicker}
            itemStyle={styles.ampmPickerItem}
            onValueChange={v => setScheduledTime(s => ({ ...s, ampm: v }))}
          >
            <Picker.Item label="AM" value="AM" />
            <Picker.Item label="PM" value="PM" />
          </Picker>
        </View>
      </View>
      <View style={styles.row}>
        <Text style={styles.label}>Duration (mins):</Text>
        <TextInput
          style={[styles.input, styles.durationInput]}
          placeholder="e.g. 30"
          keyboardType="numeric"
          value={duration}
          onChangeText={d => setDuration(d.replace(/[^0-9]/g, ''))}
        />
      </View>
      <TouchableOpacity style={styles.scheduleButton} onPress={scheduleSystem}>
        <Text style={styles.buttonText}>Add Schedule</Text>
      </TouchableOpacity>

      <FlatList
        data={schedules}
        keyExtractor={item => item.id.toString()}
        renderItem={renderSchedule}
        style={styles.scheduleList}
        ListHeaderComponent={schedules.length > 0 ? <Text style={styles.scheduleHeader}>Schedules:</Text> : null}
        ListEmptyComponent={<Text style={styles.emptyScheduleText}>No active schedules.</Text>}
      /></View>
  );
};



// --- Main App Component ---
const App = () => {
  const [hour, setHour] = useState('');
  const [day, setDay] = useState('');
  const [month, setMonth] = useState('');
  const [dayOfWeek, setDayOfWeek] = useState('');
  const [timeOfDay, setTimeOfDay] = useState('');
  const [season, setSeason] = useState('');
  const [loadShedding, setLoadShedding] = useState('');
  const [gasAvailable, setGasAvailable] = useState('');
  const [whyModeChosen, setWhyModeChosen] = useState('');

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);
  const [input, setInput] = useState('');
  const [prediction, setPrediction] = useState('');

  const handlePredict = async () => {
    try {
      const payload = {
        hour: parseInt(hour),
        day: parseInt(day),
        month: parseInt(month),
        day_of_week: dayOfWeek,
        time_of_day: timeOfDay,
        season: season,
        load_shedding: loadShedding,
        gas_available: gasAvailable,
        why_mode_chosen: whyModeChosen,
      };

const response = await fetch('http://10.0.2.2:8000/predict', {

        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(payload),
      });

      const result = await response.json();
      setPrediction(result);
    } catch (error) {
      console.error('Prediction error:', error);
    }
  };

  useEffect(() => {
    const unsubscribe = auth().onAuthStateChanged((currentUser) => {
      setUser(currentUser);
      setLoading(false);
    });
    return unsubscribe;
  }, []);

  const signUp = async () => {
    if (!email || !password) {
      Alert.alert('Error', 'Email and password cannot be empty.');
      return;
    }

    try {
      const userCredential = await auth().createUserWithEmailAndPassword(email, password);
      setUser(userCredential.user);
    } catch (error) {
      Alert.alert('Sign Up Error', error.message);
      console.error('Sign up error:', error.message);
    }
  };

  const signIn = async () => {
    if (!email || !password) {
      Alert.alert('Error', 'Email and password cannot be empty.');
      return;
    }
    try {
      const userCredential = await auth().signInWithEmailAndPassword(email, password);
      setUser(userCredential.user);
    } catch (error) {
      Alert.alert('Sign In Error', error.message);
      console.error('Sign in error:', error.message);
    }
  };

  const signOutUser = async () => {
    try {
      await auth().signOut();
      setUser(null);
    } catch (error) {
      Alert.alert('Sign Out Error', error.message);
      console.error('Sign out error:', error.message);
    }
  };

  if (loading) {
    return (
      <View style={styles.centered}>
        <Text>Loading...</Text>
      </View>
    );
  }

  if (!user) {
    return (
      <View style={styles.authContainer}>
        <TextInput
          placeholder="Email"
          onChangeText={setEmail}
          value={email}
          style={styles.authInput}
          keyboardType="email-address"
          autoCapitalize="none"
        />
        <TextInput
          placeholder="Password"
          secureTextEntry
          onChangeText={setPassword}
          value={password}
          style={styles.authInput}
        />
        <View style={styles.authButtonContainer}>
          <Button title="Sign Up" onPress={signUp} />
        </View>
        <View style={styles.authButtonContainer}>
          <Button title="Sign In" onPress={signIn} />
        </View>
      </View>
    );
  }

  const userId = user.uid;

  const appData = [
    { type: 'system', key: 'geyser', title: 'Geyser System', systemPath: `users/${userId}/geyser-system` },
    { type: 'system', key: 'heater', title: 'Heater System', systemPath: `users/${userId}/heater-system` },
  ];

return (
  <KeyboardAvoidingView
    style={{ flex: 1 }}
    behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    keyboardVerticalOffset={100}
  >
    <ScrollView
      keyboardShouldPersistTaps="handled"
      contentContainerStyle={styles.scrollContentContainer}
    >
      {/* Welcome Section */}
      <View style={styles.welcomeContainer}>
        <Text style={styles.welcomeText}>Welcome!</Text>
        <Button title="Sign Out" onPress={signOutUser} color="#e74c3c" />
      </View>

      {/* Prediction UI Section */}
      <View style={{ padding: 20 }}>
        <TextInput placeholder="Hour" value={hour} onChangeText={setHour} keyboardType="numeric" />
        <TextInput placeholder="Day" value={day} onChangeText={setDay} keyboardType="numeric" />
        <TextInput placeholder="Month" value={month} onChangeText={setMonth} keyboardType="numeric" />
        <TextInput placeholder="Day of Week (e.g. Monday)" value={dayOfWeek} onChangeText={setDayOfWeek} />
        <TextInput placeholder="Time of Day (e.g. Morning)" value={timeOfDay} onChangeText={setTimeOfDay} />
        <TextInput placeholder="Season (e.g. Summer)" value={season} onChangeText={setSeason} />
        <TextInput placeholder="Load Shedding (Yes/No)" value={loadShedding} onChangeText={setLoadShedding} />
        <TextInput placeholder="Gas Available (Yes/No)" value={gasAvailable} onChangeText={setGasAvailable} />
        <TextInput placeholder="Why Mode Chosen (Cheap/Fast/Reliable)" value={whyModeChosen} onChangeText={setWhyModeChosen} />

        <Button title="Predict" onPress={handlePredict} />
        <Text style={{ marginTop: 20 }}>
          Prediction: {prediction && JSON.stringify(prediction, null, 2)}
        </Text>
      </View>

      {/* SystemControl items */}
      {appData.map((item) =>
        item.type === 'system' ? (
          <View key={item.key} style={styles.scrollContentContainer}>
            <SystemControl title={item.title} systemPath={item.systemPath} />
          </View>
        ) : null
      )}
    </ScrollView>
  </KeyboardAvoidingView>
);
};



  /*return (
    <ScrollView style={styles.container} contentContainerStyle={styles.scrollContentContainer}>
      <View style={styles.welcomeContainer}>
        <Text style={styles.welcomeText}>Welcome, {user.email || 'User'}!</Text>
        <Button title="Sign Out" onPress={signOutUser} color="#e74c3c" />
      </View>
      <SystemControl title="Geyser System" systemPath={`users/${userId}/geyser-system`} />
      <SystemControl title="Heater System" systemPath={`users/${userId}/heater-system`} />
    </ScrollView>
  );
};
/*<SystemControl title="Geyser System" systemPath="/geyser-system" />*/

const styles = StyleSheet.create({
  // App specific styles
  container: {
    flex: 1,
    backgroundColor: '#f0f4f8',
  },
  scrollContentContainer: {
    padding: 20,
  },
  welcomeContainer: {
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 20,
    paddingBottom: 10,
    borderBottomWidth: 1,
    borderBottomColor: '#ddd',
  },


  welcomeText: {
    fontSize: 18,
    fontWeight: 'bold',
    color: '#34495e'
  },
  centered: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: '#f0f4f8',
  },
  authContainer: {
    flex: 1,
    justifyContent: 'center',
    padding: 20,
    backgroundColor: '#f0f4f8',
  },
  authInput: {
    height: 45,
    borderColor: '#bdc3c7',
    borderWidth: 1,
    marginBottom: 12,
    paddingHorizontal: 10,
    borderRadius: 5,
    backgroundColor: '#fff',
    fontSize: 16,
  },
  authButtonContainer: {
    marginTop: 10,
  },

  // SystemControl specific styles
  systemContainer: {
    backgroundColor: '#fff',
    borderRadius: 12,
    padding: 20,
    marginBottom: 25,
    shadowColor: '#000',
    shadowOpacity: 0.08,
    shadowRadius: 15,
    shadowOffset: { width: 0, height: 4 },
    elevation: 5
  },
  title: {
    fontSize: 22, // Slightly reduced for balance
    fontWeight: 'bold',
    color: '#2c3e50',
    marginBottom: 20,
    borderBottomColor: '#ecf0f1',
    borderBottomWidth: 1,
    paddingBottom: 10
  },
  subHeader: {
    fontSize: 18,
    fontWeight: '600',
    color: '#34495e',
    marginTop: 25, // Increased top margin
    marginBottom: 15 // Increased bottom margin
  },
  row: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginVertical: 10 // Reduced vertical margin for tighter rows
  },
  label: {
    fontSize: 16,
    color: '#34495e',
    flexShrink: 1, // Allow label to shrink if value is long
    marginRight: 8 // Reduced margin
  },
  value: {
    fontSize: 16,
    color: '#2c3e50',
    fontWeight: '500',
    textAlign: 'right', // Align value to the right
    flexGrow: 1, // Allow value to take remaining space
  },
  tempControl: {
    flexDirection: 'row',
    alignItems: 'center'
  },
  tempButton: {
    width: 36, // Slightly smaller
    height: 36, // Slightly smaller
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: '#3498db',
    borderRadius: 8,
    marginHorizontal: 10
  },
  buttonText: { // General button text
    color: '#fff',
    fontSize: 16,
    fontWeight: 'bold'
  },
   buttonTextLg: { // For +/- buttons
    color: '#fff',
    fontSize: 20,
    fontWeight: 'bold'
  },
  picker: {
    height: 50,
    flexBasis: 150, // Give picker a base width
    flexGrow: 1, // Allow it to grow
    backgroundColor: '#ecf0f1',
    borderRadius: 5,
    paddingHorizontal: 5, // Added padding
  },
  timePicker: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#ecf0f1',
    borderRadius: 5,
    paddingHorizontal: 5,
    paddingVertical: 3, // Added vertical padding
  },
  timeInput: {
    width: 45, // Adjusted width
    height: 40,
    borderColor: '#bdc3c7',
    borderWidth: 1,
    borderRadius: 5,
    marginHorizontal: 3,
    textAlign: 'center',
    fontSize: 16,
    backgroundColor: '#fff'
  },
  timeSeparator: {
    fontSize: 18,
    fontWeight: 'bold',
    marginHorizontal: 2
  },
  ampmPicker: {
    width: 90, // Adjusted width
    height: 40, // Ensure consistent height with inputs
    borderWidth: 0, // Remove default border if any
  },
  ampmPickerItem: { // For iOS styling
    height: 40,
  },
  input: { // General input style (used for duration)
    height: 40,
    borderColor: '#bdc3c7',
    borderWidth: 1,
    borderRadius: 5,
    textAlign: 'center',
    fontSize: 16,
    backgroundColor: '#fff'
  },
  durationInput: {
    width: 70
  },
  scheduleButton: {
    backgroundColor: '#27ae60',
    paddingVertical: 12,
    paddingHorizontal: 15,
    borderRadius: 8,
    alignItems: 'center',
    marginTop: 20, // Increased margin
    marginBottom: 25 // Increased margin
  },
  scheduleList: {
    marginTop: 20,
    minHeight: 100 // Ensure it has some height even when empty
  },
  scheduleHeader: {
    fontSize: 18,
    fontWeight: '600',
    color: '#34495e',
    marginBottom: 10
  },
  scheduleItem: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 12,
    borderBottomColor: '#ecf0f1',
    borderBottomWidth: 1
  },
  scheduleDetails: {
    flex: 1,
    marginRight: 10
  },
  scheduleText: {
    fontSize: 15,
    color: '#2c3e50'
  },
  scheduleNextRunText: {
    fontSize: 13,
    color: '#7f8c8d',
    marginTop: 3
  },
  deleteButton: {
    paddingVertical: 8,
    paddingHorizontal: 12,
    backgroundColor: '#e74c3c',
    borderRadius: 5
  },
  deleteText: {
    color: '#fff',
    fontSize: 14,
    fontWeight: '500'
  },
  emptyScheduleText: {
    textAlign: 'center',
    color: '#7f8c8d',
    marginTop: 20,
    fontStyle: 'italic'
  }

                              });

  export default App;