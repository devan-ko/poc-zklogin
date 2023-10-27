"use client";

import { useLayoutEffect, useState } from "react";
import jwt_decode from "jwt-decode";
import {
  LoginResponse,
  PersistentData,
  UserKeyData,
} from "@/app/types/UserInfo";

import {
  genAddressSeed,
  generateRandomness,
  getZkSignature,
  jwtToAddress,
  ZkSignatureInputs,
} from "@mysten/zklogin";
import axios from "axios";
import { toBigIntBE } from "bigint-buffer";
import { fromB64 } from "@mysten/bcs";
import { useSui } from "@/app/hooks/useSui";
import { SerializedSignature } from "@mysten/sui.js/src/cryptography";
import { Ed25519Keypair } from "@mysten/sui.js/keypairs/ed25519";
import { Secp256k1Keypair } from "@mysten/sui.js/keypairs/secp256k1";
import { TransactionBlock } from "@mysten/sui.js/transactions";
import { Blocks } from "react-loader-spinner";

export default function Page() {
  const [error, setError] = useState<string | null>(null);
  const [publicKey, setPublicKey] = useState<string | null>(null);
  const [txDigest, setTxDigest] = useState<string | null>(null);
  const [voteTxDigest, setVoteTxDigest] = useState<string | null>(null);
  const [jwtEncoded, setJwtEncoded] = useState<string | null>(null);
  const [userAddress, setUserAddress] = useState<string | null>(null);
  const [userSalt, setUserSalt] = useState<string | null>(null);
  const [userBalance, setUserBalance] = useState<number>(0);
  const [transactionInProgress, setTransactionInProgress] =
    useState<boolean>(false);
  const [votingMembers, setVotingMembers] = useState<string[] | null>([]);
  const [userVotingID, setUserVotingID] = useState<string | null>(null);
  const [votedAddress, setVotedAddress] = useState<string | null>(null);

  const { suiClient } = useSui();

  const GROUP ="0xecd7a8a4e42ee7f939d6067722e1f9a88c39ec12ce7796e4f7fe74685ee6d50d";
  const PKG_ID="0x715b8f1de858b9779f515cd166a438991627f3adbc229565bc57733995a900c8";

  async function getSalt(subject: string, encodedJwt: string) {
    const dataRequest: PersistentData = {
      subject: subject,
      jwt: encodedJwt!,
    };
    console.log("Subject = ", subject);
    const response = await axios.post("/api/userinfo/get/salt", dataRequest);

    console.log("getSalt response = ", response);
    if (response?.data.status == 200) {
      const userData: PersistentData = response.data.data as PersistentData;
      console.log("Salt fetched! Salt = ", userData.salt);
      return userData.salt;
    } else {
      console.log("Error Getting SALT");
      return null;
    }
  }

  function storeUserKeyData(encodedJwt: string, subject: string, salt: string) {
    const userKeyData: UserKeyData = JSON.parse(
      localStorage.getItem("userKeyData")!
    );
    const dataToStore: PersistentData = {
      ephemeralPublicKey: userKeyData.ephemeralPublicKey,
      jwt: encodedJwt,
      salt: salt,
      subject: subject,
    };
    axios
      .post("/api/userinfo/store", dataToStore)
      .then((response) => {
        console.log("response = ", response);
      })
      .catch((error) => {
        console.log("error = ", error);
      });
  }

  function printUsefulInfo(
    decodedJwt: LoginResponse,
    userKeyData: UserKeyData
  ) {
    console.log("iat  = " + decodedJwt.iat);
    console.log("iss  = " + decodedJwt.iss);
    console.log("sub = " + decodedJwt.sub);
    console.log("aud = " + decodedJwt.aud);
    console.log("exp = " + decodedJwt.exp);
    console.log("nonce = " + decodedJwt.nonce);
    console.log("ephemeralPublicKey b64 =", userKeyData.ephemeralPublicKey);
  }

  async function executeTransactionWithZKP(
    partialZkSignature: ZkSignatureInputs,
    ephemeralKeyPair: Ed25519Keypair,
    userKeyData: UserKeyData,
    decodedJwt: LoginResponse
  ) {
    console.log("partialZkSignature = ", partialZkSignature);
    const txb = new TransactionBlock();

    //Just a simple Demo call to create a little NFT weapon :p
    txb.moveCall({
      target: `0xf8294cd69d69d867c5a187a60e7095711ba237fad6718ea371bf4fbafbc5bb4b::teotest::create_weapon`, //demo package published on testnet
      arguments: [
        txb.pure("Zero Knowledge Proof Axe 9000"), // weapon name
        txb.pure(66), // weapon damage
      ],
    });
    txb.setSender(userAddress!);

    const signatureWithBytes = await txb.sign({
      client: suiClient,
      signer: ephemeralKeyPair,
    });

    console.log("Got SignatureWithBytes = ", signatureWithBytes);
    console.log("maxEpoch = ", userKeyData.maxEpoch);
    console.log("userSignature = ", signatureWithBytes.signature);

    const addressSeed = genAddressSeed(
      BigInt(userSalt!),
      "sub",
      decodedJwt.sub,
      decodedJwt.aud
    );

    const zkSignature: SerializedSignature = getZkSignature({
      inputs: {
        ...partialZkSignature,
        addressSeed: addressSeed.toString(),
      },
      maxEpoch: userKeyData.maxEpoch,
      userSignature: signatureWithBytes.signature,
    });

    suiClient
      .executeTransactionBlock({
        transactionBlock: signatureWithBytes.bytes,
        signature: zkSignature,
        options: {
          showEffects: true,
        },
      })
      .then((response) => {
        if (response.effects?.status.status) {
          console.log("Transaction executed! Digest = ", response.digest);
          setTxDigest(response.digest);
          setTransactionInProgress(false);
        } else {
          console.log(
            "Transaction failed! reason = ",
            response.effects?.status
          );
          setTransactionInProgress(false);
        }
      })
      .catch((error) => {
        console.log("Error During Tx Execution. Details: ", error);
        setTransactionInProgress(false);
      });
  }



  async function getZkProofAndExecuteTx() {
    setTransactionInProgress(true);
    const decodedJwt: LoginResponse = jwt_decode(jwtEncoded!) as LoginResponse;
    const {userKeyData, ephemeralKeyPair} = getEphemeralKeyPair();
    printUsefulInfo(decodedJwt, userKeyData);
    const ephemeralPublicKeyArray: Uint8Array = fromB64(userKeyData.ephemeralPublicKey);
    const zkpPayload =
        {
            jwt: jwtEncoded!,
            extendedEphemeralPublicKey: toBigIntBE(
                Buffer.from(ephemeralPublicKeyArray),
            ).toString(),
            jwtRandomness: userKeyData.randomness,
            maxEpoch: userKeyData.maxEpoch,
            salt: userSalt,
            keyClaimName: "sub"
        };
    console.log("about to post zkpPayload = ", zkpPayload);
    setPublicKey(zkpPayload.extendedEphemeralPublicKey);
    //Invoking our custom backend to delagate Proof Request to Mysten backend.
    // Delegation was done to avoid CORS errors.
    //TODO: Store proof to avoid fetching it every time.
    const proofResponse = await axios.post('/api/zkp/get', zkpPayload);
    if(!proofResponse?.data?.zkp){
        createRuntimeError("Error getting Zero Knowledge Proof. Please check that Prover Service is running.");
        return;
    }
    console.log("zkp response = ", proofResponse.data.zkp);
    const partialZkSignature: ZkSignatureInputs = proofResponse.data.zkp as ZkSignatureInputs;
    
    await executeTransactionWithZKP(partialZkSignature, ephemeralKeyPair, userKeyData, decodedJwt);
    
  }

  function getEphemeralKeyPair() {
    const userKeyData: UserKeyData = JSON.parse(
      localStorage.getItem("userKeyData")!
    );
    let ephemeralKeyPairArray = Uint8Array.from(
      Array.from(fromB64(userKeyData.ephemeralPrivateKey!))
    );
    const ephemeralKeyPair = Ed25519Keypair.fromSecretKey(
      ephemeralKeyPairArray
    );
    return { userKeyData, ephemeralKeyPair };
  }

  async function checkIfAddressHasBalance(address: string): Promise<boolean> {
    console.log("Checking whether address " + address + " has balance...");
    const coins = await suiClient.getCoins({
      owner: address,
    });
    //loop over coins
    let totalBalance = 0;
    for (const coin of coins.data) {
      totalBalance += parseInt(coin.balance);
    }
    totalBalance = totalBalance / 1000000000; //Converting MIST to SUI
    setUserBalance(totalBalance);
    console.log("total balance = ", totalBalance);
    return totalBalance > 0;
  }

  async function checkAddrHasVotingPass(address: string): Promise<object> {
    
    console.log("Checking " + address + " has voting pass...");
    const resp = await suiClient.getOwnedObjects({
      owner: address,
      options: {
        showType: true,
      },
    });
    const [votingPassObj] = resp.data.filter((item) => {
      return (
        item.data?.type ===
        `${PKG_ID}::vote::VotingPass`
      );
    });
    const votingPassId = votingPassObj.data?.objectId!;

    console.log(`Voter ${address} with vote pass: ${votingPassId} is voting`);
    if (votingPassId) {
      const groupmembers = await getAddressesInGroup("0", GROUP);
      const fileterRes = groupmembers.filter((item) => {
        return item !== address;
      });
      console.log("votingPassObj = ", votingPassId);
      console.log("fileterRes = ", fileterRes);
      return { votingPassId, fileterRes };
    }
    return {};
  }

  async function getAddressesInGroup(
    groupNumber: string,
    groups: string
  ): Promise<string[]> {
    const resp: any = await suiClient.getObject({
      id: groups,
      options: { showContent: true },
    });
    const groupsId = resp.data?.content?.fields?.groups.fields.id.id;
    const dfs: any = await suiClient.getDynamicFieldObject({
      parentId: groupsId,
      name: { type: "u64", value: groupNumber },
    });
    const membersId =
      dfs.data?.content?.fields?.value?.fields?.members?.fields?.id?.id;
    const members: any = await suiClient.getDynamicFields({
      parentId: membersId,
    });
    const voters: string[] = [];
    members.data.forEach((item: any) => {
      voters.push(item?.name?.value);
    });
    return voters;
  }

  async function executeVoteWithZKP(
    partialZkSignature: ZkSignatureInputs,
    ephemeralKeyPair: Ed25519Keypair,
    userKeyData: UserKeyData,
    decodedJwt: LoginResponse,
    address: string
  ) {
    console.log("partialZkSignature = ", partialZkSignature);
    const txb = new TransactionBlock();

    //Just a simple Demo call to create a little NFT weapon :p

    console.log("userVotingID = ", userVotingID);
    console.log("address = ", address);
    console.log("GROUP = ", GROUP);
    txb.moveCall({
        target: `${PKG_ID}::vote::vote`,
        arguments: [
            txb.object(GROUP),
            txb.object(userVotingID!),
            txb.pure(address),
        ],
    });
    txb.setSender(userAddress!);

    const signatureWithBytes = await txb.sign({
      client: suiClient,
      signer: ephemeralKeyPair,
    });

    console.log("Got SignatureWithBytes = ", signatureWithBytes);
    console.log("maxEpoch = ", userKeyData.maxEpoch);
    console.log("userSignature = ", signatureWithBytes.signature);

    const addressSeed = genAddressSeed(
      BigInt(userSalt!),
      "sub",
      decodedJwt.sub,
      decodedJwt.aud
    );

    const zkSignature: SerializedSignature = getZkSignature({
      inputs: {
        ...partialZkSignature,
        addressSeed: addressSeed.toString(),
      },
      maxEpoch: userKeyData.maxEpoch,
      userSignature: signatureWithBytes.signature,
    });

    suiClient
      .executeTransactionBlock({
        transactionBlock: signatureWithBytes.bytes,
        signature: zkSignature,
        options: {
          showEffects: true,
        },
      })
      .then((response) => {
        if (response.effects?.status.status) {
          console.log("Transaction executed! Digest = ", response.digest);
          setVoteTxDigest(response.digest);
          setVotedAddress(address);
          setTransactionInProgress(false);
          
        } else {
          console.log(
            "Transaction failed! reason = ",
            response.effects?.status
          );
          setTransactionInProgress(false);
        }
      })
      .catch((error) => {
        console.log("Error During Tx Execution. Details: ", error);
        setTransactionInProgress(false);
      });
  }


  async function startVoting(address: string)  {
    setTransactionInProgress(true);
    const decodedJwt: LoginResponse = jwt_decode(jwtEncoded!) as LoginResponse;
    const {userKeyData, ephemeralKeyPair} = getEphemeralKeyPair();
    printUsefulInfo(decodedJwt, userKeyData);
    const ephemeralPublicKeyArray: Uint8Array = fromB64(userKeyData.ephemeralPublicKey);
    const zkpPayload =
        {
            jwt: jwtEncoded!,
            extendedEphemeralPublicKey: toBigIntBE(
                Buffer.from(ephemeralPublicKeyArray),
            ).toString(),
            jwtRandomness: userKeyData.randomness,
            maxEpoch: userKeyData.maxEpoch,
            salt: userSalt,
            keyClaimName: "sub"
        };
    console.log("about to post zkpPayload = ", zkpPayload);
    setPublicKey(zkpPayload.extendedEphemeralPublicKey);
    //Invoking our custom backend to delagate Proof Request to Mysten backend.
    // Delegation was done to avoid CORS errors.
    //TODO: Store proof to avoid fetching it every time.
    const proofResponse = await axios.post('/api/zkp/get', zkpPayload);
    if(!proofResponse?.data?.zkp){
        createRuntimeError("Error getting Zero Knowledge Proof. Please check that Prover Service is running.");
        return;
    }
    console.log("zkp response = ", proofResponse.data.zkp);
    const partialZkSignature: ZkSignatureInputs = proofResponse.data.zkp as ZkSignatureInputs;
    setVotingMembers([]);
    setVotedAddress(null);
        
    await executeVoteWithZKP(partialZkSignature, ephemeralKeyPair, userKeyData, decodedJwt, address);


}
    async function startVoting_test(address: string)  {
        setVotingMembers([]);
        setVotedAddress(null);
        setVoteTxDigest(null);
        const testVoteTxdigest = "0xblahblah I love alex"
        console.log("startVoting address = ", address);
        setVotedAddress(address);
        setVoteTxDigest(testVoteTxdigest);
        
    }

  async function giveSomeTestCoins(address: string) {
    console.log("Giving some test coins to address " + address);
    setTransactionInProgress(true);
    //let adminPrivateKeyArray = Uint8Array.from(Array.from(fromB64(process.env.NEXT_PUBLIC_ADMIN_SECRET_KEY!)));
    let adminPhrase = process.env.NEXT_PUBLIC_ADMIN_PHRASE as string;
    //const adminKeypair = Secp256k1Keypair.fromSecretKey(adminPrivateKeyArray.slice(1));
    const adminKeypair = Secp256k1Keypair.deriveKeypair(adminPhrase);
    const tx = new TransactionBlock();
    const giftCoin = tx.splitCoins(tx.gas, [tx.pure(300000000)]);

    tx.transferObjects([giftCoin], tx.pure(address));

    const res = await suiClient.signAndExecuteTransactionBlock({
      transactionBlock: tx,
      signer: adminKeypair,
      requestType: "WaitForLocalExecution",
      options: {
        showEffects: true,
      },
    });
    const status = res?.effects?.status?.status;
    if (status === "success") {
      console.log("Gift Coin transfer executed! status = ", status);
      checkIfAddressHasBalance(address);
      setTransactionInProgress(false);
    }
    if (status == "failure") {
      createRuntimeError("Gift Coin transfer Failed. Error = " + res?.effects);
    }
  }

  async function loadRequiredData(encodedJwt: string) {
    //Decoding JWT to get useful Info
    const decodedJwt: LoginResponse = jwt_decode(encodedJwt!) as LoginResponse;

    //Getting Salt
    const userSalt = await getSalt(decodedJwt.sub, encodedJwt);
    if (!userSalt) {
      createRuntimeError("Error getting userSalt");
      return;
    }
    //Storing UserKeyData
    storeUserKeyData(encodedJwt!, decodedJwt.sub, userSalt!);

    //Generating User Address
    const address = jwtToAddress(encodedJwt!, BigInt(userSalt!));

    setUserAddress(address);
    setUserSalt(userSalt!);

    const balance = await checkIfAddressHasBalance(address);
    if (!balance) {
      giveSomeTestCoins(address);
    }

    const votingPassObj: any = await checkAddrHasVotingPass(address);

    setUserVotingID(votingPassObj.votingPassId || "");
    setVotingMembers(votingPassObj.fileterRes || []);
    console.log("All required data loaded. ZK Address =", address);
  }



  useLayoutEffect(() => {
    setError(null);
    const hash = new URLSearchParams(window.location.hash.slice(1));
    const jwt_token_encoded = hash.get("id_token");

    const userKeyData: UserKeyData = JSON.parse(
      localStorage.getItem("userKeyData")!
    );

    if (!jwt_token_encoded) {
      createRuntimeError("Could not retrieve a valid JWT Token!");
      return;
    }

    if (!userKeyData) {
      createRuntimeError("user Data is null");
      return;
    }

    setJwtEncoded(jwt_token_encoded);

    loadRequiredData(jwt_token_encoded);
  }, []);

  function createRuntimeError(message: string) {
    setError(message);
    console.log(message);
    setTransactionInProgress(false);
  }

  return (
    <div id="cb" className="flex flex-col items-center mt-10">
      <h1>Callback page</h1>

      <div id="header" className="pb-5 pt-6">
        <h4>Login with External Provider Completed</h4>
      </div>

      {userAddress ? (
        <div className="flex flex-col items-center mt-10">
          <h3>Zklogin user onboarding has been done in success! </h3>
          <h4>Address Generation Completed!</h4>
          <div id="contents" className="font-medium pb-6 pt-6">
            <p>User Address = {userAddress}</p>
          </div>
          <div id="contents" className="font-medium pb-6 pt-6">
            <p>Address Balance = {userBalance.toFixed(3)} SUI</p>
          </div>
        </div>
      ) : null}

      {votingMembers &&votingMembers.length > 0 ? (
        <div className="flex flex-col items-center mt-10">
          <div>
            <h3>Voting has begun</h3>
          </div>
          {votingMembers.map((item, index) => (
            <button key={index} 
            className={`bg-gray-400 text-white px-4 py-2 rounded-md mb-2 ${item !== votedAddress ? '' : 'hidden'}`}
            onClick={() => startVoting(item)}
            >
              <h3>{item as String}</h3>
            </button>
          ))}
        </div>
      ) : null}

      {txDigest ? (
        <div className="flex flex-col items-center mt-10">
          <h3>Transaction Completed!</h3>
          <div id="contents" className="font-medium pb-6 pt-6">
            <p>TxDigest = {txDigest}</p>
          </div>
          <div id="contents" className="font-medium pb-6">
            <button
              className="bg-gray-400 text-white px-4 py-2 rounded-md"
              disabled={!userAddress}
              onClick={() =>
                window.open(
                  `https://suiexplorer.com/txblock/${txDigest}?network=testnet`,
                  "_blank"
                )
              }
            >
              See it on Sui Explorer
            </button>
          </div>
        </div>
      ) : null}

      {voteTxDigest ? (
        <div className="flex flex-col items-center mt-10">
          <h3>Vote Transaction Completed!</h3>
          <div id="contents" className="font-medium pb-6 pt-6">
            <p>voteTxDigest = {voteTxDigest}</p>
          </div>
          <div id="contents" className="font-medium pb-6">
            <button
              className="bg-gray-400 text-white px-4 py-2 rounded-md"
              disabled={!voteTxDigest}
              onClick={() =>
                window.open(
                  `https://suiexplorer.com/txblock/${voteTxDigest}?network=testnet`,
                  "_blank"
                )
              }
            >
              See vote transaction on Sui Explorer
            </button>
          </div>
        </div>
      ) : null}

      {transactionInProgress ? (
        <div className="flex space-x-4 justify-center">
          <Blocks
            visible={true}
            height="80"
            width="80"
            ariaLabel="blocks-loading"
            wrapperStyle={{}}
            wrapperClass="blocks-wrapper"
          />
        </div>
      ) : null}

      {error ? (
        <div id="header" className="pb-5 pt-6 text-red-500 text-xl">
          <h2>{error}</h2>
        </div>
      ) : null}
    </div>
  );
}
