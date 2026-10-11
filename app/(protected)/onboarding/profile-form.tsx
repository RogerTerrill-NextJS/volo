'use client';
import SharedProfileForm from '../_components/profile-form';
import {completeProfile} from './actions';

export default function ProfileForm({unavailable=false}:{unavailable?:boolean}){
 return <SharedProfileForm unavailable={unavailable} save={completeProfile} permalink="/onboarding" submitLabel="Save profile and continue"/>;
}
