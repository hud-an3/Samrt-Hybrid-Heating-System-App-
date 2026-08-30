# Smart Hybrid Heating System – Mobile App

This repository contains the **React Native mobile application** developed as part of my **Smart Hybrid Heating System** final year project and published paper.
>**"Development of a Smart Hybrid Heating System with Intelligent Energy Management*"**
>Noor-Ul-Huda, Muhammad Muneeb Khan, Abd Ur Rehman and Mumajjed Ul Mudassir.
>*IEEE/ICoDT2,2025.*
>[[Read the Paper](https://ieeexplore.ieee.org/document/11360742)]

## Overview

The app serves as the **user interface and control layer** for a hybrid **Electric + Gas heating system**, enabling real-time monitoring, intelligent control, and user feedback. It is integrated with **Firebase Cloud** for data synchronization, communicates with **ESP32-based hardware**, and leverages a **Machine Learning (MLP) model** deployed via **FastAPI** for intelligent decision-making.

The mobile app acts as the bridge between the user, cloud, hardware, and ML model.

---

## Key Features

*  Real-time temperature and system status monitoring
*  Manual and automatic switching between **Electric** and **Gas** heating modes
*  Intelligent heating recommendations using an **MLP model**
*  Cloud-based control via **Firebase Realtime Database**
*  Remote hardware control through ESP32
*  User preference input for comfort-based optimization

---

## Technology Stack

* **Frontend (Mobile App):** React Native
* **Backend API:** FastAPI (Python)
* **Machine Learning:** Multi-Layer Perceptron (MLP)
* **Cloud Platform:** Firebase Realtime Database
* **Embedded System:** ESP32
* **Communication:** REST APIs + Firebase listeners

---

## Hardware Control Flow

1. User interacts with the mobile app
2. Control commands are written to Firebase
3. ESP32 reads commands from Firebase
4. ESP32 actuates electric or gas heating components
5. Sensor data is sent back to Firebase
6. App UI updates in real time

---

## Installation & Setup

### Clone the repository

```bash
git clone https://github.com/USERNAME/REPO_NAME.git
cd REPO_NAME
```

### Install dependencies

```bash
npm install
```

### Firebase configuration

Create a Firebase project and add your configuration in the app.

### 4️⃣ Run the app

```bash
npm start
```
