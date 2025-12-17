from fastapi import FastAPI
from pydantic import BaseModel
import joblib
from fastapi import FastAPI
from pydantic import BaseModel
from typing import Literal
import numpy as np
import pandas as pd
import joblib
import json
from tensorflow.keras.models import load_model
from fastapi.middleware.cors import CORSMiddleware
from tensorflow.keras.losses import MeanSquaredError

# Initialize FastAPI app
app = FastAPI()

# Enable CORS for frontend communication
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],  # Replace with specific origin in production
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Load model and preprocessing tools
model = load_model('checkpoints/best_model.h5',compile=False)
scaler = joblib.load('checkpoints/scaler.pkl')
label_encoder = joblib.load('checkpoints/label_encoder.pkl')

# Recompile manually to fix the 'mse' issue
model.compile(
    optimizer='adam',
    loss={
        'mode_output': 'sparse_categorical_crossentropy',
        'temp_output': MeanSquaredError(),
        'duration_output': MeanSquaredError()
    },
    loss_weights={
        'mode_output': 1.0,
        'temp_output': 0.4,
        'duration_output': 0.4,
    },
    metrics={
        'mode_output': 'accuracy',
        'temp_output': 'mae',
        'duration_output': 'mae'
    }
)



# Load expected input column names (after one-hot encoding)
with open('checkpoints/input_columns.json') as f:
    expected_columns = json.load(f)

# === Define Input Schema ===
class Features(BaseModel):
    hour: int
    day: int
    month: int
    day_of_week: Literal["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"]
    time_of_day: Literal["Morning", "Afternoon", "Evening", "Night"]
    season: Literal["Summer", "Winter", "Spring", "Fall"]
    load_shedding: Literal["Yes", "No"]
    gas_available: Literal["Yes", "No"]
    why_mode_chosen: Literal["Cheap", "Fast", "Reliable"]

# === Prediction Endpoint ===
@app.post("/predict")
def predict(features: Features):
    try:
        # Convert input to DataFrame
        input_dict = features.dict()
        df = pd.DataFrame([input_dict])

        # One-hot encode categorical variables
        df = pd.get_dummies(df)

        # Align with expected input columns
        df = df.reindex(columns=expected_columns, fill_value=0)

        # Scale input
        scaled = scaler.transform(df)

        # Predict
        preds = model.predict(scaled)
        mode_class = np.argmax(preds[0], axis=1)[0]
        mode_label = label_encoder.inverse_transform([mode_class])[0]
        temperature = float(preds[1][0][0])
        duration = float(preds[2][0][0])

        return {
            "mode": mode_label,
            "set_temperature": round(temperature, 2),
            "duration_minutes": round(duration, 2)
        }

    except Exception as e:
        return {"error": str(e)}
