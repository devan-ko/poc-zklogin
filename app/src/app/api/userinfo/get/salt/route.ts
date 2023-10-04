import { NextRequest, NextResponse } from "next/server";
import { kv } from "@vercel/kv";
import {PersistentData} from "@/app/types/UserInfo";

const randomStr = "0xcafecafe";
export async function POST(request: NextRequest) {
    
    const body = await request.json();
    try {
        let dataRequest: PersistentData = body as PersistentData;
        console.log("checking zklogin req data param datarequest : " + dataRequest);
        console.log("checking zklogin req data param subject : " + dataRequest.subject);
        console.log("checking zklogin req data param jwt : " + dataRequest.jwt);
        if (dataRequest && dataRequest.subject && dataRequest.jwt) {
            console.log("Received request for FETCHING Salt for subject ", dataRequest.subject);
            let response = await kv.get(dataRequest.subject);
            if(!response) {
                console.log("Salt not found in KV store. Fetching from Mysten API. jwt = ", dataRequest.jwt, "subject = ", dataRequest.subject);
                const saltFromMysten = await getSaltFromMystenAPI(dataRequest.jwt!);
                if (!saltFromMysten) {
                    console.log("salt couldn't get salt server put kv ");
                    response = {subject: dataRequest.subject, salt: randomStr} ;
                    return NextResponse.json({status: 200, statusText: "OK", data: response});
                }else {
                    console.log( "salt from mysten : ", saltFromMysten)
                    response = {subject: dataRequest.subject, salt: saltFromMysten} ;
                    console.log("response from mysten = ", response);
                }

            }
            
            return NextResponse.json({status: 200, statusText: "OK", data: response});
        }
    }catch (e) {
        console.log("Wrong Request Body Format!. Inner error= ",e);
        return NextResponse.json({status:422, statusText: "Wrong Body Format!. Inner Error= "+e, data: ""});
    }
}

async function getSaltFromMystenAPI(jwtEncoded : string ){
    const url = "http://salt.api-devnet.mystenlabs.com/get_salt";
    const payload = {token: jwtEncoded};

    const response = await fetch(url, {
        method: "POST",
        mode: "cors",
        cache: "no-cache",
        headers: {
            "Content-Type": "application/json",
        },
        referrerPolicy: "no-referrer",
        body: JSON.stringify(payload),
    });
    const responseJson = await response.json();
    console.log(JSON.stringify(responseJson));
    return responseJson.salt;
}