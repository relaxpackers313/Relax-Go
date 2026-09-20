import { useEffect, useRef, useState } from 'react';
import { Animated, Dimensions, Easing, Image, StyleSheet, Text, View } from 'react-native';

const LOGO = require('../assets/splash-logo.png');
const BIKE = require('../assets/vehicles/bike.png');
const CAR = require('../assets/vehicles/car.png');

/**
 * Branded launch intro (Swiggy/Uber-style): logo pops in, vehicles ride across a road line,
 * the wordmark rises, then the whole overlay fades out and hands over to the app.
 */
export function Intro({ tag, onDone }: { tag?: string; onDone: () => void }) {
  const [gone, setGone] = useState(false);
  const logo = useRef(new Animated.Value(0)).current;
  const word = useRef(new Animated.Value(0)).current;
  const ride = useRef(new Animated.Value(0)).current;
  const fade = useRef(new Animated.Value(1)).current;
  const width = Dimensions.get('window').width;

  useEffect(() => {
    Animated.sequence([
      Animated.parallel([
        Animated.spring(logo, { toValue: 1, useNativeDriver: true, friction: 6, tension: 60 }),
        Animated.timing(ride, { toValue: 1, duration: 1300, easing: Easing.inOut(Easing.quad), useNativeDriver: true }),
        Animated.timing(word, { toValue: 1, duration: 500, delay: 300, useNativeDriver: true }),
      ]),
      Animated.delay(300),
      Animated.timing(fade, { toValue: 0, duration: 300, useNativeDriver: true }),
    ]).start(() => {
      setGone(true);
      onDone();
    });
  }, [logo, word, ride, fade, onDone]);

  if (gone) return null;

  const bikeX = ride.interpolate({ inputRange: [0, 1], outputRange: [-70, width + 40] });
  const carX = ride.interpolate({ inputRange: [0, 1], outputRange: [width + 60, -80] });

  return (
    <Animated.View style={[StyleSheet.absoluteFillObject, styles.wrap, { opacity: fade }]} pointerEvents="none">
      <Animated.Image
        source={LOGO}
        style={{ width: 140, height: 140, opacity: logo, transform: [{ scale: logo.interpolate({ inputRange: [0, 1], outputRange: [0.7, 1] }) }] }}
        resizeMode="contain"
      />
      <Animated.View style={{ alignItems: 'center', opacity: word, transform: [{ translateY: word.interpolate({ inputRange: [0, 1], outputRange: [16, 0] }) }] }}>
        <Text style={styles.wordmark}>
          Relax <Text style={{ color: '#0f766e' }}>Go</Text>
        </Text>
        {tag ? (
          <View style={styles.tag}>
            <Text style={styles.tagText}>{tag}</Text>
          </View>
        ) : (
          <Text style={styles.tagline}>Nearby drivers, one tap away.</Text>
        )}
      </Animated.View>

      {/* The road */}
      <View style={styles.roadWrap}>
        <View style={styles.road} />
        <Animated.View style={[styles.rider, { transform: [{ translateX: bikeX }, { rotate: '90deg' }] }]}>
          <Image source={BIKE} style={{ width: 26, height: 46 }} resizeMode="contain" />
        </Animated.View>
        <Animated.View style={[styles.rider, { top: 26, transform: [{ translateX: carX }, { rotate: '-90deg' }] }]}>
          <Image source={CAR} style={{ width: 26, height: 50 }} resizeMode="contain" />
        </Animated.View>
      </View>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  wrap: { backgroundColor: '#ffffff', alignItems: 'center', justifyContent: 'center', zIndex: 999, elevation: 24 },
  wordmark: { fontSize: 34, fontWeight: '900', color: '#0b1220', letterSpacing: 0.5, marginTop: 14 },
  tagline: { marginTop: 6, color: '#64748b', fontSize: 14, fontWeight: '600' },
  tag: { marginTop: 8, backgroundColor: '#0b1220', borderRadius: 8, paddingHorizontal: 10, paddingVertical: 3 },
  tagText: { color: '#fff', fontSize: 12, fontWeight: '800', letterSpacing: 2 },
  roadWrap: { position: 'absolute', bottom: 120, left: 0, right: 0, height: 80 },
  road: { position: 'absolute', top: 38, left: 24, right: 24, height: 2, borderRadius: 1, backgroundColor: '#e2e8f0' },
  rider: { position: 'absolute', top: -14, left: 0 },
});
