// Navigation.js
import React, { useState, useEffect } from 'react';
import { NavigationContainer } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import auth from '@react-native-firebase/auth';
import SignInScreen from '../components/auth/SignInScreen';
import SignUpScreen from '../components/auth/SignUpScreen';
import App from '../App'; // Go up one folder


const Stack = createNativeStackNavigator();

const Navigation = () => {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const unsubscribe = auth().onAuthStateChanged((authUser) => {
      setUser(authUser);
      setLoading(false);
    });
    return unsubscribe; // Cleanup the listener on unmount
  }, []);

  if (loading) {
    // You can show a loading spinner here
    return null;
  }

  return (
    <NavigationContainer>
      <Stack.Navigator screenOptions={{ headerShown: false }}>
        {user ? (
          <Stack.Screen name="MainApp" component={App} options={{ headerShown: false }} />
        ) : (
          <>
            <Stack.Screen name="SignIn" component={SignInScreen} options={{ headerShown: false }} />
            <Stack.Screen name="SignUp" component={SignUpScreen} options={{ headerShown: false }} />
          </>
        )}
      </Stack.Navigator>
    </NavigationContainer>
  );
}; // ← You were missing this closing brace!

export default Navigation;
