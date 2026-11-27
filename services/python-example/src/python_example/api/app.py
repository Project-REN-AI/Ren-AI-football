# SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
from fastapi import FastAPI, HTTPException, status
from pydantic import BaseModel

from python_example.domain.greeting import BlankNameError, greet

app = FastAPI(title="python-example")


class GreetingResponse(BaseModel):
    message: str


@app.get("/greetings/{name}")
def read_greeting(name: str) -> GreetingResponse:
    try:
        return GreetingResponse(message=greet(name))
    except BlankNameError as error:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_CONTENT, str(error)) from error
